import type { Request, Response } from "express";
import { z } from "zod";
import * as whiteboardService from "../services/whiteboardService";
import { isValidRoomId } from "../utils/roomId";

const joinCodeParamSchema = z.object({
  joinCode: z.string().refine(isValidRoomId, "Code de réunion invalide."),
});

export async function getWhiteboard(req: Request, res: Response): Promise<void> {
  const { joinCode } = joinCodeParamSchema.parse(req.params);
  const data = await whiteboardService.getWhiteboard(joinCode, req.user!.id);
  res.status(200).json({ data });
}

const saveWhiteboardSchema = z.object({
  // On ne valide pas la structure exacte des strokes ici (variable selon
  // l'outil) — le frontend est la seule source qui écrit ce format,
  // c'est une sauvegarde de snapshot, pas une API publique tierce.
  data: z.object({ strokes: z.array(z.unknown()) }),
});

export async function saveWhiteboard(req: Request, res: Response): Promise<void> {
  const { joinCode } = joinCodeParamSchema.parse(req.params);
  const { data } = saveWhiteboardSchema.parse(req.body);
  await whiteboardService.saveWhiteboard(joinCode, req.user!.id, data);
  res.status(200).json({ message: "Tableau enregistré." });
}
