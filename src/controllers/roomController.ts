import type { Request, Response } from "express";
import { generateRoomId } from "../utils/roomId";
import type { CreateRoomResponse } from "../types";

/**
 * Crée un nouvel identifiant de salle. On ne crée pas la salle sur LiveKit
 * ici — LiveKit crée la salle automatiquement dès que le premier participant
 * s'y connecte avec un token valide. Ce endpoint sert juste à obtenir un
 * identifiant lisible à partager.
 */
export function createRoom(req: Request, res: Response<CreateRoomResponse>): void {
  const roomId = generateRoomId();
  const frontendOrigin = process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173";

  res.status(201).json({
    roomId,
    roomUrl: `${frontendOrigin}/room/${roomId}`,
  });
}
