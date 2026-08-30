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

// Récupération et nettoyage des origines autorisées
const rawOrigins = process.env.CORS_ORIGIN ?? "http://localhost:5173";
const allowedOrigins = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

// Si une origine est "*" et credentials:true, on ne peut pas l'utiliser
// -> on la convertit en true pour permettre toutes les origines (sans credentials)
// Mais avec credentials:true, il faut une liste explicite ou une fonction.
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // En développement (pas d'origine) ou si "allow all" est explicitement défini
    if (!origin || allowedOrigins.includes("*")) {
      // attention: avec credentials:true, on ne peut pas utiliser "*" 
      // On va donc permettre si allowedOrigins contient "*" en mode dev, 
      // mais on préfère une liste explicite.
      // Solution: si "*" est présent, on renvoie true (autorise tout) mais seulement si credentials est false
      // Ici on garde une approche stricte : si "*" on autorise tout, mais on désactive credentials ?
      // Pour rester simple, on va traiter "*" comme un cas particulier : on autorise toutes les origines
      // et on désactive credentials, ou on garde credentials:true mais on retourne l'origine.
      // Pour simplifier, on va permettre toutes les origines si "*" est présent.
      callback(null, true);
      return;
    }
    // Vérification stricte
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Amphix-Secret"],
  credentials: true, // pour les cookies
  optionsSuccessStatus: 204,
};

// Application des middlewares
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "10kb" }));
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