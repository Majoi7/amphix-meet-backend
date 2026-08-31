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
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Amphix-Secret"],
  credentials: true,
  optionsSuccessStatus: 204,
};

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