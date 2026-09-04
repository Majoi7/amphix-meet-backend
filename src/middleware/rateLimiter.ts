import rateLimit from "express-rate-limit";

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX ?? 30);

/**
 * Limite le nombre de requêtes par IP — protège surtout l'endpoint de génération
 * de tokens contre les abus (création massive de connexions LiveKit).
 */
export const apiRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "rate_limited",
    message: "Trop de requêtes. Réessaie dans un instant.",
  },
});

/**
 * Limiteur moins restrictif pour les endpoints d'authentification publics
 * (inscription, connexion, etc.) afin d'éviter de bloquer les utilisateurs légitimes
 * provenant du même IP (ex: même réseau scolaire).
 */
export const authRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 100), // 100 requêtes par minute par défaut
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "rate_limited",
    message: "Trop de requêtes. Réessaie dans un instant.",
  },
});
