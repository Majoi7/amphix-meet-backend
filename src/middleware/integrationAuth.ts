import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { ApiRequestError } from "./errorHandler";

const AMPHIX_INTEGRATION_SECRET = process.env.AMPHIX_INTEGRATION_SECRET ?? "";

if (!AMPHIX_INTEGRATION_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    "[integrationAuth] AMPHIX_INTEGRATION_SECRET manquant — l'intégration Amphix sera inutilisable."
  );
}

/**
 * Auth serveur-à-serveur pour Amphix (pas un utilisateur humain) : un
 * secret partagé attendu dans l'en-tête X-Amphix-Secret, comparé en temps
 * constant pour éviter les attaques par timing.
 */
export function requireIntegrationSecret(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const provided = req.headers["x-amphix-secret"];
  if (
    typeof provided !== "string" ||
    !AMPHIX_INTEGRATION_SECRET ||
    !safeEqual(provided, AMPHIX_INTEGRATION_SECRET)
  ) {
    throw new ApiRequestError(401, "invalid_integration_secret", "Secret d'intégration invalide.");
  }
  next();
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}