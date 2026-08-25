import { BookingStatus, MeetingStatus, ParticipantRole, RoomStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { generateRoomId } from "../utils/roomId";
import {
  createParticipantToken,
  getLivekitUrl,
  muteParticipantMicrophone,
  removeParticipantFromRoom,
  endRoom,
} from "./livekitService";
import { ApiRequestError } from "../middleware/errorHandler";

/// Durée de séance : 3h par défaut ET en plancher — cohérent avec le
/// TTL minimum déjà imposé côté token LiveKit (MIN_SESSION_SECONDS dans
/// livekitService.ts). Une valeur plus longue peut être demandée, jamais
/// plus courte.
const DEFAULT_SESSION_MINUTES = 180;

export interface CreateMeetingInput {
  hostId: string;
  title?: string;
  allowGuest?: boolean;
  durationMinutes?: number;
  /// Utilisateurs pré-autorisés à rejoindre même si allowGuest=false —
  /// utilisé par bookingService pour préinscrire l'élève sur une séance
  /// privée sans avoir besoin d'ouvrir la salle à tout le monde.
  preRegisteredParticipantIds?: string[];
}

export interface CreateMeetingResult {
  meetingId: string;
  joinCode: string;
  title: string;
  endsAt: Date;
}

/**
 * Crée une réunion instantanée (status IN_PROGRESS dès la création — les
 * réunions programmées avec scheduledAt viendront dans un futur passage
 * dédié à la réservation élève/prof). Crée aussi sa Room technique
 * associée et enregistre l'hôte comme premier participant.
 */
export async function createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult> {
  const joinCode = await generateUniqueJoinCode();
  const durationMinutes = Math.max(
    input.durationMinutes ?? DEFAULT_SESSION_MINUTES,
    DEFAULT_SESSION_MINUTES
  );
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + durationMinutes * 60_000);

  const meeting = await prisma.meeting.create({
    data: {
      joinCode,
      title: input.title?.trim() || "Réunion Amphix Meet",
      hostId: input.hostId,
      allowGuest: input.allowGuest ?? true,
      status: MeetingStatus.IN_PROGRESS,
      durationMinutes,
      startedAt,
      endsAt,
      room: {
        create: {
          externalRoomName: joinCode,
          status: RoomStatus.PENDING,
        },
      },
      participants: {
        create: [
          { userId: input.hostId, role: ParticipantRole.HOST },
          ...(input.preRegisteredParticipantIds ?? [])
            .filter((id) => id !== input.hostId) // évite un doublon si jamais
            .map((userId) => ({ userId, role: ParticipantRole.PARTICIPANT })),
        ],
      },
    },
  });

  return {
    meetingId: meeting.id,
    joinCode: meeting.joinCode,
    title: meeting.title,
    endsAt: meeting.endsAt!,
  };
}

async function generateUniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomId();
    const existing = await prisma.meeting.findUnique({ where: { joinCode: code } });
    if (!existing) return code;
  }
  throw new ApiRequestError(500, "join_code_generation_failed", "Réessaie dans un instant.");
}

export interface MeetingListItem {
  meetingId: string;
  joinCode: string;
  title: string;
  status: MeetingStatus;
  isHost: boolean;
  hostName: string;
  createdAt: Date;
  startedAt: Date | null;
  endsAt: Date | null;
  endedAt: Date | null;
}

/** Liste les réunions où l'utilisateur est hôte OU a déjà participé — la
 * base du dashboard (Phase 4). Les plus récentes en premier, limité à 20
 * pour l'instant (pagination à ajouter si besoin plus tard). */
export async function listMyMeetings(userId: string): Promise<MeetingListItem[]> {
  const meetings = await prisma.meeting.findMany({
    where: {
      OR: [{ hostId: userId }, { participants: { some: { userId } } }],
    },
    include: { host: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return meetings.map((meeting) => ({
    meetingId: meeting.id,
    joinCode: meeting.joinCode,
    title: meeting.title,
    status: meeting.status,
    isHost: meeting.hostId === userId,
    hostName: meeting.host.name,
    createdAt: meeting.createdAt,
    startedAt: meeting.startedAt,
    endsAt: meeting.endsAt,
    endedAt: meeting.endedAt,
  }));
}

export interface MeetingSummary {
  meetingId: string;
  joinCode: string;
  title: string;
  status: MeetingStatus;
  isHost: boolean;
  hostName: string;
  endsAt: Date | null;
}

export async function getMeetingByJoinCode(
  joinCode: string,
  requestingUserId: string
): Promise<MeetingSummary> {
  const meeting = await prisma.meeting.findUnique({
    where: { joinCode },
    include: { host: true },
  });

  if (!meeting) {
    throw new ApiRequestError(404, "meeting_not_found", "Cette réunion n'existe pas.");
  }

  return {
    meetingId: meeting.id,
    joinCode: meeting.joinCode,
    title: meeting.title,
    status: meeting.status,
    isHost: meeting.hostId === requestingUserId,
    hostName: meeting.host.name,
    endsAt: meeting.endsAt,
  };
}

export interface JoinMeetingInput {
  joinCode: string;
  userId: string;
}

export interface JoinMeetingResult {
  token: string;
  livekitUrl: string;
  roomId: string; // = joinCode, gardé pour compatibilité avec le frontend existant
  role: ParticipantRole;
  endsAt: Date | null;
}

/**
 * Point d'entrée central des permissions de la Phase 2 : vérifie que
 * l'utilisateur a le droit de rejoindre AVANT de générer un token LiveKit.
 * Autorisé si : hôte, déjà participant enregistré, ou allowGuest=true.
 */
export async function joinMeeting(input: JoinMeetingInput): Promise<JoinMeetingResult> {
  const [meeting, user] = await Promise.all([
    prisma.meeting.findUnique({
      where: { joinCode: input.joinCode },
      include: { room: true, participants: true },
    }),
    prisma.user.findUnique({ where: { id: input.userId } }),
  ]);

  if (!user) {
    throw new ApiRequestError(401, "unauthorized", "Utilisateur introuvable.");
  }

  if (!meeting || !meeting.room) {
    throw new ApiRequestError(404, "meeting_not_found", "Cette réunion n'existe pas.");
  }

  if (meeting.status === MeetingStatus.COMPLETED || meeting.status === MeetingStatus.CANCELLED) {
    throw new ApiRequestError(410, "meeting_ended", "Cette réunion est terminée.");
  }

  const isHost = meeting.hostId === input.userId;
  const existingParticipant = meeting.participants.find((p) => p.userId === input.userId);

  if (!isHost && !existingParticipant && !meeting.allowGuest) {
    throw new ApiRequestError(
      403,
      "not_invited",
      "Tu n'es pas invité à cette réunion."
    );
  }

  const role = isHost ? ParticipantRole.HOST : ParticipantRole.PARTICIPANT;

  // Crée l'enregistrement de participation s'il n'existe pas encore
  // (cas d'un invité ou d'un guest qui rejoint pour la première fois).
  await prisma.meetingParticipant.upsert({
    where: { meetingId_userId: { meetingId: meeting.id, userId: input.userId } },
    create: { meetingId: meeting.id, userId: input.userId, role, joinedAt: new Date() },
    update: { joinedAt: new Date(), leftAt: null },
  });

  if (meeting.room.status === RoomStatus.PENDING) {
    await prisma.room.update({
      where: { id: meeting.room.id },
      data: { status: RoomStatus.ACTIVE },
    });
  }

  const token = await createParticipantToken({
    roomName: meeting.room.externalRoomName,
    userId: input.userId,
    displayName: user.name,
    isHost,
  });

  return {
    token,
    livekitUrl: getLivekitUrl(),
    roomId: meeting.joinCode,
    role,
    endsAt: meeting.endsAt,
  };
}

/**
 * Ferme automatiquement toute réunion IN_PROGRESS dont l'heure de fin
 * (endsAt) est dépassée — appelée périodiquement par le scheduler
 * (jobs/meetingScheduler.ts). Termine réellement la salle LiveKit (tout
 * le monde est déconnecté), pas juste le statut en base.
 */
export async function autoEndExpiredMeetings(): Promise<number> {
  const expiredMeetings = await prisma.meeting.findMany({
    where: { status: MeetingStatus.IN_PROGRESS, endsAt: { lte: new Date() } },
    include: { room: true },
  });

  for (const meeting of expiredMeetings) {
    if (meeting.room) {
      try {
        await endRoom(meeting.room.externalRoomName);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[autoEndExpiredMeetings] Impossible de fermer la salle LiveKit ${meeting.room.externalRoomName}:`,
          err
        );
        // On continue quand même à marquer la réunion terminée en base —
        // mieux vaut un statut cohérent qu'une salle fantôme bloquante.
      }
    }

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: MeetingStatus.COMPLETED, endedAt: new Date() },
    });

    if (meeting.room) {
      await prisma.room.update({
        where: { meetingId: meeting.id },
        data: { status: RoomStatus.ENDED },
      });
    }

    await prisma.booking.updateMany({
      where: { meetingId: meeting.id, status: BookingStatus.IN_PROGRESS },
      data: { status: BookingStatus.COMPLETED },
    });
  }

  return expiredMeetings.length;
}

/** Vérifie que l'appelant est bien l'hôte et renvoie la Room technique associée. */
async function requireHostAndRoom(joinCode: string, requestingUserId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { joinCode },
    include: { room: true },
  });

  if (!meeting || !meeting.room) {
    throw new ApiRequestError(404, "meeting_not_found", "Cette réunion n'existe pas.");
  }
  if (meeting.hostId !== requestingUserId) {
    throw new ApiRequestError(403, "forbidden", "Seul l'hôte peut modérer la réunion.");
  }

  return meeting.room;
}

export async function muteParticipant(
  joinCode: string,
  requestingUserId: string,
  targetUserId: string
): Promise<void> {
  if (targetUserId === requestingUserId) {
    throw new ApiRequestError(400, "invalid_target", "Tu ne peux pas te couper toi-même.");
  }
  const room = await requireHostAndRoom(joinCode, requestingUserId);
  await muteParticipantMicrophone(room.externalRoomName, targetUserId);
}

export async function removeParticipant(
  joinCode: string,
  requestingUserId: string,
  targetUserId: string
): Promise<void> {
  if (targetUserId === requestingUserId) {
    throw new ApiRequestError(400, "invalid_target", "Tu ne peux pas te retirer toi-même.");
  }
  const room = await requireHostAndRoom(joinCode, requestingUserId);
  await removeParticipantFromRoom(room.externalRoomName, targetUserId);

  await prisma.meetingParticipant.updateMany({
    where: { meeting: { joinCode }, userId: targetUserId },
    data: { leftAt: new Date() },
  });
}

export async function endMeeting(joinCode: string, requestingUserId: string): Promise<void> {
  const meeting = await prisma.meeting.findUnique({ where: { joinCode } });

  if (!meeting) {
    throw new ApiRequestError(404, "meeting_not_found", "Cette réunion n'existe pas.");
  }
  if (meeting.hostId !== requestingUserId) {
    throw new ApiRequestError(403, "forbidden", "Seul l'hôte peut terminer la réunion.");
  }

  await prisma.$transaction([
    prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: MeetingStatus.COMPLETED, endedAt: new Date() },
    }),
    prisma.room.update({
      where: { meetingId: meeting.id },
      data: { status: RoomStatus.ENDED },
    }),
    prisma.booking.updateMany({
      where: { meetingId: meeting.id, status: BookingStatus.IN_PROGRESS },
      data: { status: BookingStatus.COMPLETED },
    }),
  ]);
}