import type { Request, Response } from "express";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import * as authService from "../services/authService";
import { ApiRequestError } from "../middleware/errorHandler";

const REFRESH_COOKIE_NAME = "amphix_refresh_token";
const REFRESH_COOKIE_PATH = "/api/v1/auth";
const isProduction = process.env.NODE_ENV === "production";

/**
 * Les attributs du cookie de refresh, définis UNE fois.
 *
 * POSER ET SUPPRIMER DOIVENT PARLER DU MÊME COOKIE.
 *
 * Un navigateur ne remplace ou n'efface un cookie que si le `Set-Cookie`
 * reçu désigne le MÊME couple (nom, domaine, chemin) — et il n'applique
 * la suppression que si l'en-tête est lui-même accepté. Écrire les deux
 * listes d'attributs séparément les laissait diverger : la suppression
 * annonçait `sameSite: "none"` quel que soit l'environnement, alors que la
 * pose émet `lax` hors production. Or un navigateur REJETTE un
 * `SameSite=None` qui n'est pas aussi `Secure` — ce qui est exactement le
 * cas en développement, où `secure` vaut `false`. L'en-tête d'effacement
 * était donc écarté, et le cookie de refresh survivait à la déconnexion :
 * l'utilisateur se croyait déconnecté, mais un rechargement de page
 * rouvrait sa session à partir du cookie resté en place.
 *
 * Une seule source pour ces quatre attributs, donc. `httpOnly`, `secure`,
 * `sameSite` et `path` sont IDENTIQUES à la pose et à la suppression ;
 * seul `expires`, qui dit *quand*, appartient à l'appelant — dans le futur
 * pour poser, dans le passé pour supprimer.
 */
const refreshCookieAttributes = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? ("none" as const) : ("lax" as const),
  path: REFRESH_COOKIE_PATH,
};

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieAttributes,
    expires: expiresAt,
  });
}

/**
 * `res.clearCookie` pose lui-même une date d'expiration dans le passé
 * (`new Date(1)`) : c'est cette date qui supprime, et la répéter ici ne
 * ferait que dupliquer une valeur que l'API choisit déjà.
 */
function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieAttributes);
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
  // z.string().url() rejette les data URLs base64 (l'avatar est stocké en
  // base64 côté client faute d'infra de stockage fichiers) — on valide juste
  // que c'est une image en data URL, ou une URL http(s) classique.
  avatarUrl: z
    .string()
    .max(2_000_000, "Image trop lourde.")
    .refine(
      (val) => val.startsWith("data:image/") || /^https?:\/\//.test(val),
      "Format d'image invalide."
    )
    .optional(),
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
