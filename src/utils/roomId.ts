import { customAlphabet } from "nanoid";

// Alphabet lisible : pas de 0/O ni 1/I/L pour éviter la confusion à l'oral
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const generate = customAlphabet(ALPHABET, 6);

/**
 * Génère un identifiant de salle court et lisible, ex: "X7K92A"
 */
export function generateRoomId(): string {
  return generate();
}

/**
 * Un identifiant de salle valide fait 4 à 12 caractères alphanumériques.
 * On valide strictement côté serveur avant de créer un token LiveKit —
 * jamais de confiance dans une valeur venant du client.
 */
const ROOM_ID_PATTERN = /^[A-Za-z0-9-]{4,12}$/;

export function isValidRoomId(roomId: unknown): roomId is string {
  return typeof roomId === "string" && ROOM_ID_PATTERN.test(roomId);
}

const PARTICIPANT_NAME_PATTERN = /^.{1,50}$/;

export function isValidParticipantName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    PARTICIPANT_NAME_PATTERN.test(name.trim()) &&
    name.trim().length > 0
  );
}
