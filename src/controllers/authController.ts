import type { Request, Response } from "express";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import * as authService from "../services/authService";
import { ApiRequestError } from "../middleware/errorHandler";

const REFRESH_COOKIE_NAME = "amphix_refresh_token";
const isProduction = process.env.NODE_ENV === "production";

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "none",
    expires: expiresAt,
    path: "/api/v1/auth",
  });
}
function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/v1/auth",
  });
}
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Le mot de passe doit faire au moins 8 caractères."),
  name: z.string().min(1).max(100),
  role: z.nativeEnum(UserRole).default(UserRole.STUDENT),
});

export async function register(req: Request, res: Response): Promise<void> {
  const input = registerSchema.parse(req.body);
  const { user, tokens } = await authService.registerUser(input);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(201).json({ user, accessToken: tokens.accessToken });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const { user, tokens } = await authService.loginUser(input);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(200).json({ user, accessToken: tokens.accessToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawRefreshToken) {
    throw new ApiRequestError(401, "missing_refresh_token", "Aucune session active.");
  }
  const { user, tokens } = await authService.rotateRefreshToken(rawRefreshToken);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(200).json({ user, accessToken: tokens.accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawRefreshToken) {
    await authService.revokeRefreshToken(rawRefreshToken);
  }
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await authService.getUserById(req.user!.id);
  res.status(200).json({ user });
}

const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
});

export async function updateMe(req: Request, res: Response): Promise<void> {
  const input = updateMeSchema.parse(req.body);
  const user = await authService.updateProfile(req.user!.id, input);
  res.status(200).json({ user });
}

const verifyEmailSchema = z.object({ token: z.string().min(1) });

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { token } = verifyEmailSchema.parse(req.body);
  await authService.verifyEmail(token);
  res.status(200).json({ message: "Adresse email vérifiée." });
}

const forgotPasswordSchema = z.object({ email: z.string().email() });

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = forgotPasswordSchema.parse(req.body);
  await authService.requestPasswordReset(email);
  // Réponse identique que l'email existe ou non — évite l'énumération de comptes.
  res.status(200).json({
    message: "Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.",
  });
}

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Le mot de passe doit faire au moins 8 caractères."),
});

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, newPassword);
  res.status(200).json({ message: "Mot de passe mis à jour. Reconnecte-toi." });
}
