import type { Request, Response } from "express";
import { createParticipantToken, getLivekitUrl } from "../services/livekitService";
import { isValidParticipantName, isValidRoomId } from "../utils/roomId";
import { ApiRequestError } from "../middleware/errorHandler";
import type { TokenResponse } from "../types";

/**
 * Génère un token d'accès pour qu'un participant rejoigne une salle.
 * C'est le SEUL endroit où l'API Secret LiveKit est utilisée — jamais
 * exposée au frontend.
 */
export async function issueToken(
  req: Request,
  res: Response<TokenResponse>
): Promise<void> {
  const { roomId, participantName } = req.body ?? {};

  if (!isValidRoomId(roomId)) {
    throw new ApiRequestError(
      400,
      "invalid_room_id",
      "Identifiant de salle invalide."
    );
  }

  if (!isValidParticipantName(participantName)) {
    throw new ApiRequestError(
      400,
      "invalid_participant_name",
      "Le nom doit contenir entre 1 et 50 caractères."
    );
  }

  const token = await createParticipantToken(roomId, participantName.trim());

  res.status(200).json({
    token,
    livekitUrl: getLivekitUrl(),
    roomId,
  });
}
