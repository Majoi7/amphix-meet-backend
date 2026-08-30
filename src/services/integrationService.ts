import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";
import { generateOpaqueToken } from "../lib/tokens";
import { signAccessTokenWithTtl } from "../lib/jwt";
import { createMeeting } from "./meetingService";
import { ApiRequestError } from "../middleware/errorHandler";

// Marge ajoutée après endsAt pour tolérer une petite dérive d'horloge / latence.
const EMBED_TOKEN_BUFFER_SECONDS = 5 * 60;

export interface CreateAmphixSessionInput {
  externalSessionId: string;
  teacher: { email: string; name: string };
  student: { email: string; name: string };
  subject: string;
  durationMinutes?: number;
}

export interface CreateAmphixSessionResult {
  meetingId: string;
  joinUrlTeacher: string;
  joinUrlStudent: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Trouve un utilisateur "fantôme" par email ou en crée un. Mot de passe
 * aléatoire et jamais communiqué (impossible à utiliser pour un vrai
 * login), email marqué vérifié directement. L'utilisateur Amphix ne voit
 * jamais ce compte.
 */
async function findOrCreateShadowUser(input: {
  email: string;
  name: string;
  role: UserRole;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return existing;

  const unusablePasswordHash = await hashPassword(generateOpaqueToken());
  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: unusablePasswordHash,
      emailVerifiedAt: new Date(),
    },
  });
}

function embedTtlSeconds(endsAt: Date): number {
  const remainingMs = endsAt.getTime() - Date.now();
  return Math.max(Math.ceil(remainingMs / 1000) + EMBED_TOKEN_BUFFER_SECONDS, 60);
}

function issueEmbedToken(
  user: { id: string; email: string; role: UserRole },
  endsAt: Date
): string {
  return signAccessTokenWithTtl(
    { sub: user.id, email: user.email, role: user.role },
    embedTtlSeconds(endsAt)
  );
}

function buildJoinUrl(joinCode: string, token: string): string {
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  return `${frontendUrl}/embed/room/${joinCode}?token=${token}`;
}

/** Retry côté Amphix sur un external_session_id déjà connu : on ne recrée
 * pas de réunion, on regénère juste des tokens embed frais. */
async function rebuildResultForExisting(meetingId: string): Promise<CreateAmphixSessionResult> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { host: true, participants: { include: { user: true } } },
  });
  if (!meeting || !meeting.endsAt) {
    throw new ApiRequestError(410, "meeting_ended", "Cette séance n'existe plus.");
  }

  const studentParticipant = meeting.participants.find((p) => p.userId !== meeting.hostId);
  if (!studentParticipant) {
    throw new ApiRequestError(500, "integration_inconsistent", "Séance d'intégration incohérente.");
  }

  const startedAt = new Date(
    meeting.endsAt.getTime() - (meeting.durationMinutes ?? 180) * 60_000
  );

  return {
    meetingId: meeting.id,
    joinUrlTeacher: buildJoinUrl(meeting.joinCode, issueEmbedToken(meeting.host, meeting.endsAt)),
    joinUrlStudent: buildJoinUrl(
      meeting.joinCode,
      issueEmbedToken(studentParticipant.user, meeting.endsAt)
    ),
    startsAt: startedAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
  };
}

export async function createAmphixSession(
  input: CreateAmphixSessionInput
): Promise<CreateAmphixSessionResult> {
  const existingLink = await prisma.integrationSession.findUnique({
    where: { externalSessionId: input.externalSessionId },
  });
  if (existingLink) {
    return rebuildResultForExisting(existingLink.meetingId);
  }

  const [teacher, student] = await Promise.all([
    findOrCreateShadowUser({ ...input.teacher, role: UserRole.TEACHER }),
    findOrCreateShadowUser({ ...input.student, role: UserRole.STUDENT }),
  ]);

  const meeting = await createMeeting({
    hostId: teacher.id,
    title: input.subject,
    allowGuest: false,
    requiresApproval: false,
    durationMinutes: input.durationMinutes,
    preRegisteredParticipantIds: [student.id],
  });

  await prisma.integrationSession.create({
    data: { externalSessionId: input.externalSessionId, meetingId: meeting.meetingId },
  });

  const startedAt = new Date(
    meeting.endsAt.getTime() - (input.durationMinutes ?? 180) * 60_000
  );

  return {
    meetingId: meeting.meetingId,
    joinUrlTeacher: buildJoinUrl(meeting.joinCode, issueEmbedToken(teacher, meeting.endsAt)),
    joinUrlStudent: buildJoinUrl(meeting.joinCode, issueEmbedToken(student, meeting.endsAt)),
    startsAt: startedAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
  };
}