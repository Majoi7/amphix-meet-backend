import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import authRouter from "./routes/auth";
import meetingsRouter from "./routes/meetings";
import bookingsRouter from "./routes/bookings";
import integrationsRouter from "./routes/integrations";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { startMeetingScheduler } from "./jobs/meetingScheduler";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

console.log("🚀 Démarrage du serveur Amphix Meet...");
console.log(`📦 PORT = ${PORT}`);
console.log(`🔍 CORS_ORIGIN brute = "${process.env.CORS_ORIGIN}"`);

// Récupération et nettoyage des origines autorisées
const rawOrigins = process.env.CORS_ORIGIN ?? "http://localhost:5173";
const allowedOrigins = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

console.log(`🔒 Origines autorisées (après parsing) : ${allowedOrigins.join(", ") || "aucune"}`);

// Configuration CORS avec logs
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    console.log(`🌐 Requête CORS reçue depuis l'origine : "${origin}"`);

    if (!origin) {
      console.log("ℹ️ Pas d'origine (requête du même site ou outil) → autorisée");
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes("*")) {
      console.log("⚠️ Mode 'allow all' activé (origine * dans la liste) → autorisée");
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      console.log(`✅ Origine "${origin}" autorisée ✅`);
      callback(null, true);
    } else {
      console.log(`❌ Origine "${origin}" REFUSÉE (non listée dans les origines autorisées)`);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Amphix-Secret"],
  credentials: true,
  optionsSuccessStatus: 204,
};

/* ══════════════════════════════════════════════════════════════════════
   `trust proxy` — jusqu'où croire `X-Forwarded-For`.

   Express lit l'adresse du client dans `req.ip`, et c'est elle qui alimente
   la limitation de débit. Derrière un reverse proxy (Nginx, Traefik, un
   load-balancer d'hébergeur), l'adresse de la socket est celle du proxy :
   sans réglage, tous les utilisateurs partagent le quota d'une seule
   adresse, et le premier client bruyant ferme la porte à tout le monde.

   Mais le réglage inverse est pire. `app.set("trust proxy", true)` fait
   lire `X-Forwarded-For` sans vérifier qui l'a écrit — or cet en-tête est
   fourni par le client. N'importe qui pourrait alors choisir l'adresse
   qu'on lui prête, donc changer d'identité à chaque requête et ne jamais
   atteindre le plafond. C'est exactement le contraire du but.

   D'où un réglage EXPLICITE et DÉSACTIVÉ PAR DÉFAUT : sans `TRUST_PROXY`,
   `X-Forwarded-For` est ignoré et `req.ip` est l'adresse de la socket,
   qu'un client ne peut pas falsifier. C'est le repli qui sur-restreint la
   limitation de débit — jamais celui qui la neutralise.

   FORMAT attendu (`backend/.env`) :

     TRUST_PROXY=1                      un seul relais devant l'API
     TRUST_PROXY=10.0.0.0/8,172.16.0.0/12   ces sous-réseaux-là sont des relais

   Le nombre de sauts est la forme à préférer quand elle suffit : elle ne
   fait pas confiance à une adresse, elle compte les relais, et ne retient
   que la valeur trouvée à la bonne profondeur. La liste de sous-réseaux
   est plus précise, mais suppose de connaître l'adressage du proxy.

   Toute autre valeur — `true` en tête, qui est le piège — est refusée et
   signalée dans la console. Un `TRUST_PROXY` mal écrit laisse donc le
   réglage désactivé au lieu de l'ouvrir en grand.
   ══════════════════════════════════════════════════════════════════════ */

const rawTrustProxy = (process.env.TRUST_PROXY ?? "").trim();

/** Une adresse ou un bloc CIDR — IPv4 comme IPv6, et rien d'autre. */
const PROXY_NETWORK_PATTERN = /^[0-9a-fA-F.:]+(\/\d{1,3})?$/;

function resolveTrustProxy(): string[] | number | null {
  if (rawTrustProxy.length === 0) return null;

  if (rawTrustProxy.toLowerCase() === "true") {
    console.warn(
      '⚠️ TRUST_PROXY="true" REFUSÉ : faire confiance à X-Forwarded-For sans savoir qui l\'écrit laisse chaque client choisir son adresse. Indique un nombre de relais (ex. 1) ou une liste de sous-réseaux.'
    );
    return null;
  }

  // Un nombre de relais, et rien d'autre. `Number("1abc")` vaut NaN, donc
  // `Number.isInteger` suffit à écarter les valeurs bancales ; zéro ou
  // négatif n'a pas de sens et vaut « désactivé ».
  const hops = Number(rawTrustProxy);
  if (Number.isInteger(hops) && hops > 0) return hops;

  const networks = rawTrustProxy
    .split(",")
    .map((network) => network.trim())
    .filter((network) => network.length > 0);

  if (networks.length === 0 || !networks.every((n) => PROXY_NETWORK_PATTERN.test(n))) {
    console.warn(
      `⚠️ TRUST_PROXY="${rawTrustProxy}" n'est ni un nombre de relais ni une liste d'adresses ou de blocs CIDR : ignoré, X-Forwarded-For ne sera pas lu.`
    );
    return null;
  }

  return networks;
}

const trustProxy = resolveTrustProxy();
if (trustProxy === null) {
  console.log("🔗 trust proxy désactivé (défaut) — X-Forwarded-For ignoré");
} else {
  app.set("trust proxy", trustProxy);
  console.log(
    `🔗 trust proxy activé : ${
      Array.isArray(trustProxy) ? trustProxy.join(", ") : `${trustProxy} relais`
    }`
  );
}

// Application des middlewares
app.use(helmet());
console.log("🛡️ Helmet activé");
app.use(cors(corsOptions));
console.log("🌍 CORS appliqué");
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Route santé
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "amphix-meet" });
});
// Routes API
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/meetings", meetingsRouter);
app.use("/api/v1/bookings", bookingsRouter);
app.use("/api/v1/integrations", integrationsRouter);

// Gestion d'erreurs (404 / 500)
app.use(notFoundHandler);
app.use(errorHandler);

// Démarrage
app.listen(PORT, () => {
  console.log(`✅ Amphix Meet backend en écoute sur http://localhost:${PORT}`);
  console.log(`🔒 CORS autorisé pour : ${allowedOrigins.join(", ") || "aucune"}`);
  startMeetingScheduler();
});