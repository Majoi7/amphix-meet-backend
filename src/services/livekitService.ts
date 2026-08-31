import { AccessToken, RoomServiceClient, TrackType } from "livekit-server-sdk";

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
  // eslint-disable-next-line no-console
  console.warn(
    "[livekitService] Variables LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET manquantes. " +
      "Vérifie ton fichier .env."
  );
}

const roomService = new RoomServiceClient(
  LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://"),
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

interface CreateTokenInput {
  roomName: string; // externalRoomName (Room.externalRoomName)
  userId: string; // identité stable — permet de retrouver/retirer un participant précis
  displayName: string;
  avatarUrl?: string | null;   // ← ajouté
  isHost: boolean;
}

/**
 * Génère un token d'accès LiveKit pour un participant. L'identité utilisée
 * est l'userId (stable, unique) au lieu d'un nom+suffixe aléatoire comme en
 * V1 — indispensable maintenant qu'on veut pouvoir retrouver/retirer un
 * participant précis (section 7 du cahier des charges, à implémenter).
 *
 * L'hôte reçoit `roomAdmin: true`, qui donne les droits de modération
 * LiveKit (retirer un participant, etc.) — c'est la fondation des actions
 * "mute participant" / "retirer participant" à venir.
 */
export async function createParticipantToken(input: CreateTokenInput): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: input.userId,
    name: input.displayName,
    ttl: TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({ avatarUrl: input.avatarUrl ?? undefined }),
  });

  at.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: input.isHost,
  });

  return at.toJwt();
}

export async function roomExists(externalRoomName: string): Promise<boolean> {
  try {
    const rooms = await roomService.listRooms([externalRoomName]);
    return rooms.some((r) => r.name === externalRoomName);
  } catch {
    return false;
  }
}

/**
 * Coupe le micro d'un participant à distance. Toute la modération passe
 * par le backend (jamais directement client → client) — c'est le
 * RoomServiceClient (API Secret) qui a le droit d'agir sur n'importe quel
 * participant, pas le token du participant lui-même.
 */
export async function muteParticipantMicrophone(
  externalRoomName: string,
  participantIdentity: string
): Promise<void> {
  const participant = await roomService.getParticipant(externalRoomName, participantIdentity);
  const audioTrack = participant.tracks.find((t) => t.type === TrackType.AUDIO);
  if (!audioTrack) return; // pas de micro actif à couper
  await roomService.mutePublishedTrack(
    externalRoomName,
    participantIdentity,
    audioTrack.sid,
    true
  );
}

export async function removeParticipantFromRoom(
  externalRoomName: string,
  participantIdentity: string
): Promise<void> {
  await roomService.removeParticipant(externalRoomName, participantIdentity);
}

/**
 * Ferme complètement une salle LiveKit — déconnecte tous les participants
 * immédiatement. Utilisé par le scheduler (meetingScheduler.ts) quand une
 * séance atteint son heure de fin, et disponible pour un futur bouton
 * "Terminer pour tout le monde" côté hôte.
 */
export async function endRoom(externalRoomName: string): Promise<void> {
  await roomService.deleteRoom(externalRoomName);
}

export function getLivekitUrl(): string {
  return LIVEKIT_URL;
}
