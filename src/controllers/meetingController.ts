import type { Request, Response } from "express";
import { z } from "zod";
import * as meetingService from "../services/meetingService";
import { isValidRoomId } from "../utils/roomId";
import { ApiRequestError } from "../middleware/errorHandler";

const joinCodeParamSchema = z.object({
  joinCode: z.string().refine(isValidRoomId, "Code de réunion invalide."),
});

const createMeetingSchema = z.object({
  title: z.string().max(200).optional(),
  allowGuest: z.boolean().optional(),
});

export async function createMeeting(req: Request, res: Response): Promise<void> {
  const input = createMeetingSchema.parse(req.body ?? {});
  const result = await meetingService.createMeeting({
    hostId: req.user!.id,
    title: input.title,
    allowGuest: input.allowGuest,
  });

  const frontendOrigin = process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173";
  res.status(201).json({
    meetingId: result.meetingId,
    roomId: result.joinCode, // gardé sous le nom "roomId" pour ne pas casser le frontend existant
    title: result.title,
    roomUrl: `${frontendOrigin}/room/${result.joinCode}`,
    endsAt: result.endsAt,
  });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const meetings = await meetingService.listMyMeetings(req.user!.id);
  res.status(200).json({ meetings });
}

export async function getMeeting(req: Request, res: Response): Promise<void> {
  const { joinCode } = joinCodeParamSchema.parse(req.params);
  const meeting = await meetingService.getMeetingByJoinCode(joinCode, req.user!.id);
  res.status(200).json({ meeting });
}

export async function joinMeeting(req: Request, res: Response): Promise<void> {
  const { joinCode } = joinCodeParamSchema.parse(req.params);

  if (!req.user) {
    throw new ApiRequestError(401, "unauthorized", "Authentification requise.");
  }

  const result = await meetingService.joinMeeting({
    joinCode,
    userId: req.user.id,
  });

  res.status(200).json(result);
}

const participantParamSchema = z.object({
  joinCode: z.string().refine(isValidRoomId, "Code de réunion invalide."),
  userId: z.string().min(1),
});

export async function endMeeting(req: Request, res: Response): Promise<void> {
  const { joinCode } = joinCodeParamSchema.parse(req.params);
  await meetingService.endMeeting(joinCode, req.user!.id);
  res.status(200).json({ message: "Réunion terminée." });
}

export async function muteParticipant(req: Request, res: Response): Promise<void> {
  const { joinCode, userId } = participantParamSchema.parse(req.params);
  await meetingService.muteParticipant(joinCode, req.user!.id, userId);
  res.status(200).json({ message: "Participant coupé." });
}

export async function removeParticipant(req: Request, res: Response): Promise<void> {
  const { joinCode, userId } = participantParamSchema.parse(req.params);
  await meetingService.removeParticipant(joinCode, req.user!.id, userId);
  res.status(200).json({ message: "Participant retiré." });
}
