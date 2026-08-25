import { createHash, randomBytes } from "crypto";

/**
 * Génère un token opaque aléatoire (pas un JWT) — utilisé pour les refresh
 * tokens et les liens de vérification email / reset mot de passe. Le
 * token en clair n'est JAMAIS stocké en base : seul son hash SHA-256
 * l'est. Ça limite les dégâts en cas de fuite de la base de données.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
