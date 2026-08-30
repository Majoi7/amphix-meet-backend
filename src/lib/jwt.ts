import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "";
const ACCESS_TOKEN_TTL_MINUTES = Number(
  process.env.ACCESS_TOKEN_TTL_MINUTES ?? 15
);

if (!JWT_ACCESS_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    "[jwt] JWT_ACCESS_SECRET manquant dans le .env — l'authentification ne fonctionnera pas."
  );
}

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
  role: UserRole;
}

/**
 * L'access token est un JWT classique, courte durée de vie (15 min par
 * défaut). Il n'est jamais stocké en base — sa révocation passe par
 * l'expiration naturelle. C'est le refresh token (opaque, en base) qui
 * permet d'en obtenir un nouveau.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: `${ACCESS_TOKEN_TTL_MINUTES}m`,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, JWT_ACCESS_SECRET) as AccessTokenPayload;
}
/**
 * Comme signAccessToken, mais avec une durée de vie explicite en secondes
 * au lieu du TTL fixe de 15 min. Utilisé uniquement par l'intégration Amphix
 * pour les "liens magiques" (join_url), dont le token doit rester valide
 * jusqu'à la fin de la séance.
 */
export function signAccessTokenWithTtl(
  payload: AccessTokenPayload,
  ttlSeconds: number
): string {
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: ttlSeconds });
}