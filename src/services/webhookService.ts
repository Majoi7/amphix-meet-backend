import { createHmac } from "crypto";

const WEBHOOK_URL = process.env.AMPHIX_WEBHOOK_URL ?? "";
const WEBHOOK_SECRET = process.env.AMPHIX_WEBHOOK_SECRET ?? "";

export type AmphixWebhookEvent = "meeting.started" | "meeting.ended";

/**
 * Envoi best-effort : une seule tentative, on logue en cas d'échec sans
 * jamais relancer ni faire échouer l'appelant. Suffisant pour une
 * intégration interne à deux systèmes — pas une garantie de livraison.
 * Si AMPHIX_WEBHOOK_URL n'est pas configuré, ne fait rien silencieusement.
 */
export async function sendWebhook(
  event: AmphixWebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  if (!WEBHOOK_URL) return;

  const body = JSON.stringify({ event, data: payload, sent_at: new Date().toISOString() });
  const signature = WEBHOOK_SECRET
    ? createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")
    : "";

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "X-Amphix-Signature": signature } : {}),
      },
      body,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[webhookService] ${event} refusé par Amphix (${res.status})`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[webhookService] Échec envoi webhook ${event}:`, err);
  }
}