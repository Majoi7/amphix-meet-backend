import { UserRole, VerificationTokenType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { generateOpaqueToken, hashToken } from "../lib/tokens";
import { signAccessToken } from "../lib/jwt";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  sendEmail,
} from "./emailService";
import { ApiRequestError } from "../middleware/errorHandler";

const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_HOURS = 1;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  emailVerified: boolean;
}

function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  emailVerifiedAt: Date | null;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

interface TokenPair {
  accessToken: string;
  refreshToken: string; // valeur en clair, à envoyer au client une seule fois
  refreshTokenExpiresAt: Date;
}

async function issueTokenPair(user: {
  id: string;
  email: string;
  role: UserRole;
}): Promise<TokenPair> {
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const rawRefreshToken = generateOpaqueToken();
  const refreshTokenExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: refreshTokenExpiresAt,
    },
  });

  return { accessToken, refreshToken: rawRefreshToken, refreshTokenExpiresAt };
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ApiRequestError(409, "email_taken", "Cette adresse email est déjà utilisée.");
  }

  // Un compte admin ne doit jamais pouvoir s'auto-créer via l'inscription
  // publique — seuls STUDENT et TEACHER sont autorisés ici.
  if (input.role === UserRole.ADMIN) {
    throw new ApiRequestError(
      403,
      "forbidden_role",
      "Ce rôle ne peut pas être choisi à l'inscription."
    );
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      role: input.role,
    },
  });

  await createAndSendVerificationToken(user.id, user.email);

  const tokens = await issueTokenPair(user);
  return { user: toPublicUser(user), tokens };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new ApiRequestError(401, "invalid_credentials", "Email ou mot de passe incorrect.");
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    throw new ApiRequestError(401, "invalid_credentials", "Email ou mot de passe incorrect.");
  }

  const tokens = await issueTokenPair(user);
  return { user: toPublicUser(user), tokens };
}

/**
 * Rotation du refresh token : l'ancien est révoqué, un nouveau couple
 * access/refresh est émis. Si le token présenté est invalide, expiré ou
 * déjà révoqué, on refuse — ça force un nouveau login.
 */
export async function rotateRefreshToken(
  rawRefreshToken: string
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new ApiRequestError(401, "invalid_refresh_token", "Session expirée, reconnecte-toi.");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokenPair(stored.user);
  return { user: toPublicUser(stored.user), tokens };
}

export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Révoque TOUS les refresh tokens d'un utilisateur — utilisé après un changement de mot de passe. */
async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function createAndSendVerificationToken(userId: string, email: string): Promise<void> {
  const rawToken = generateOpaqueToken();
  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      type: VerificationTokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
    },
  });
  const { subject, body } = buildVerificationEmail(rawToken);
  await sendEmail(email, subject, body);
}

export async function verifyEmail(rawToken: string): Promise<void> {
  await consumeVerificationToken(rawToken, VerificationTokenType.EMAIL_VERIFICATION, async (userId) => {
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // On ne révèle jamais si l'email existe ou non — évite l'énumération de comptes.
  if (!user) return;

  const rawToken = generateOpaqueToken();
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      type: VerificationTokenType.PASSWORD_RESET,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000),
    },
  });
  const { subject, body } = buildPasswordResetEmail(rawToken);
  await sendEmail(user.email, subject, body);
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  await consumeVerificationToken(rawToken, VerificationTokenType.PASSWORD_RESET, async (userId) => {
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // Sécurité : un reset de mot de passe invalide toutes les sessions actives.
    await revokeAllUserRefreshTokens(userId);
  });
}

/** Vérifie, marque comme utilisé et exécute l'action associée à un token — logique partagée verify-email / reset-password. */
async function consumeVerificationToken(
  rawToken: string,
  type: VerificationTokenType,
  onValid: (userId: string) => Promise<void>
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const stored = await prisma.verificationToken.findUnique({ where: { tokenHash } });

  if (
    !stored ||
    stored.type !== type ||
    stored.usedAt ||
    stored.expiresAt < new Date()
  ) {
    throw new ApiRequestError(400, "invalid_token", "Ce lien est invalide ou a expiré.");
  }

  await onValid(stored.userId);
  await prisma.verificationToken.update({
    where: { id: stored.id },
    data: { usedAt: new Date() },
  });
}

export async function getUserById(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiRequestError(404, "user_not_found", "Utilisateur introuvable.");
  }
  return toPublicUser(user);
}

export async function updateProfile(
  userId: string,
  input: { name?: string; avatarUrl?: string }
): Promise<PublicUser> {
  const user = await prisma.user.update({ where: { id: userId }, data: input });
  return toPublicUser(user);
}

export type { TokenPair };
