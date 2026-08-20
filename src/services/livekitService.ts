import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";

// Durée minimale imposée pour toute session : 3 heures. Même si TOKEN_TTL_SECONDS
// est mal configuré (trop bas) dans le .env, on ne descend jamais en dessous.
const MIN_SESSION_SECONDS = 3 * 60 * 60; // 10 800 secondes
const TOKEN_TTL_SECONDS = Math.max(
  Number(process.env.TOKEN_TTL_SECONDS ?? MIN_SESSION_SECONDS),
  MIN_SESSION_SECONDS
);

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  // On ne fait pas planter le process au chargement du module (utile pour les tests),
  // mais on log fort pour que l'erreur soit visible immédiatement au démarrage.
  // eslint-disable-next-line no-console
  console.warn(
    "[livekitService] Variables LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET manquantes. " +
      "Vérifie ton fichier .env."
  );
}

// Le RoomServiceClient permet de gérer les salles côté serveur (lister, fermer, etc.)
// Il utilise l'API Secret — ne doit JAMAIS être exposé au frontend.
const roomService = new RoomServiceClient(
  LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://"),
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/**
 * Génère un token d'accès LiveKit pour un participant donné dans une salle donnée.
 * Le token encode les permissions (publier/souscrire) et expire après TOKEN_TTL_SECONDS.
 */
export async function createParticipantToken(
  roomId: string,
  participantName: string
): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `${participantName}-${cryptoRandomSuffix()}`,
    name: participantName,
    ttl: TOKEN_TTL_SECONDS,
  });

  at.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}

/**
 * Vérifie si une salle existe déjà sur LiveKit (optionnel, utile pour valider
 * qu'un lien de réunion pointe vers une salle réellement active).
 */
export async function roomExists(roomId: string): Promise<boolean> {
  try {
    const rooms = await roomService.listRooms([roomId]);
    return rooms.some((r) => r.name === roomId);
  } catch {
    // Si LiveKit n'a pas encore créé la salle (elle se crée à la première connexion),
    // on ne considère pas ça comme une erreur bloquante.
    return false;
  }
}

export function getLivekitUrl(): string {
  return LIVEKIT_URL;
}

// Petit suffixe pour éviter les collisions d'identité si deux onglets rejoignent
// avec le même nom affiché.
function cryptoRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
