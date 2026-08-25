import { prisma } from "../lib/prisma";
import { ApiRequestError } from "../middleware/errorHandler";

const EMPTY_WHITEBOARD = { strokes: [] };

/** Même contrôle d'accès que le reste : hôte ou participant déjà enregistré. */
async function requireMeetingAccess(joinCode: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { joinCode },
    include: { participants: true },
  });
  if (!meeting) {
    throw new ApiRequestError(404, "meeting_not_found", "Cette réunion n'existe pas.");
  }
  const isHost = meeting.hostId === userId;
  const isParticipant = meeting.participants.some((p) => p.userId === userId);
  if (!isHost && !isParticipant) {
    throw new ApiRequestError(403, "forbidden", "Tu n'as pas accès à cette réunion.");
  }
  return meeting;
}

export async function getWhiteboard(joinCode: string, userId: string): Promise<unknown> {
  const meeting = await requireMeetingAccess(joinCode, userId);
  const whiteboard = await prisma.whiteboard.findUnique({ where: { meetingId: meeting.id } });
  return whiteboard?.data ?? EMPTY_WHITEBOARD;
}

export async function saveWhiteboard(
  joinCode: string,
  userId: string,
  data: unknown
): Promise<void> {
  const meeting = await requireMeetingAccess(joinCode, userId);
  await prisma.whiteboard.upsert({
    where: { meetingId: meeting.id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: { meetingId: meeting.id, data: data as any },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: { data: data as any },
  });
}
