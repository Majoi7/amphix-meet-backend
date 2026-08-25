/**
 * ⚠️ STUB — n'envoie aucun email réel, se contente de logger dans la
 * console. À remplacer par un vrai fournisseur (Resend, SendGrid, Postmark…)
 * avant la mise en production de l'authentification. L'interface de cette
 * fonction (to, subject, body) ne devrait pas changer quand tu brancheras
 * le vrai service — seule l'implémentation à l'intérieur changera.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `\n[emailService] 📧 (STUB — pas d'envoi réel)\nÀ: ${to}\nSujet: ${subject}\n${body}\n`
  );
}

export function buildVerificationEmail(rawToken: string): { subject: string; body: string } {
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const link = `${frontendUrl}/verify-email?token=${rawToken}`;
  return {
    subject: "Vérifie ton adresse email — Amphix Meet",
    body: `Clique sur ce lien pour vérifier ton adresse email : ${link}\n\nCe lien expire dans 24h.`,
  };
}

export function buildPasswordResetEmail(rawToken: string): { subject: string; body: string } {
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const link = `${frontendUrl}/reset-password?token=${rawToken}`;
  return {
    subject: "Réinitialisation de ton mot de passe — Amphix Meet",
    body: `Clique sur ce lien pour choisir un nouveau mot de passe : ${link}\n\nCe lien expire dans 1h. Si tu n'es pas à l'origine de cette demande, ignore cet email.`,
  };
}
