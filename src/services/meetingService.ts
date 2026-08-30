import { BookingStatus, LobbyRequestStatus, MeetingStatus, ParticipantRole, RoomStatus } from "@prisma/client";
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
import { sendWebhook } from "./webhookService";
/// Durée de séance : 3h par défaut ET en plancher — cohérent avec le
/// TTL minimum déjà imposé côté token LiveKit (MIN_SESSION_SECONDS dans
/// livekitService.ts). Une valeur plus longue peut être demandée, jamais
/// plus courte.
const DEFAULT_SESSION_MINUTES = 180;

export interface CreateMeetingInput {
  hostId: string;
  title?: string;
  allowGuest?: boolean;
  requiresApproval?: boolean;
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
      requiresApproval: input.requiresApproval ?? false,
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

interface FinalizedJoin {
  token: string;
  livekitUrl: string;
  roomId: string;
  role: ParticipantRole;
  endsAt: Date | null;
}

export type JoinMeetingOutcome =
  | { waiting: true; lobbyRequestId: string }
  | ({ waiting: false } & FinalizedJoin);

/** Upsert du participant + activation de la Room + génération du token —
 * logique partagée entre le join direct et l'approbation d'une demande
 * de salle d'attente (getLobbyRequestStatus). */
async function finalizeJoin(
  meeting: {
    id: string;
    joinCode: string;
    endsAt: Date | null;
    room: { id: string; externalRoomName: string; status: RoomStatus };
    integrationSession?: { externalSessionId: string } | null;
  },
  userId: string,
  displayName: string,
  isHost: boolean
): Promise<FinalizedJoin> {
  const role = isHost ? ParticipantRole.HOST : ParticipantRole.PARTICIPANT;

  await prisma.meetingParticipant.upsert({
    where: { meetingId_userId: { meetingId: meeting.id, userId } },
    create: { meetingId: meeting.id, userId, role, joinedAt: new Date() },
    update: { joinedAt: new Date(), leftAt: null },
  });

  if (meeting.room.status === RoomStatus.PENDING) {
    await prisma.room.update({
      where: { id: meeting.room.id },
      data: { status: RoomStatus.ACTIVE },
    });

    if (meeting.integrationSession) {
      void sendWebhook("meeting.started", {
        external_session_id: meeting.integrationSession.externalSessionId,
        meeting_id: meeting.id,
      });
    }
  }

  const token = await createParticipantToken({
    roomName: meeting.room.externalRoomName,
    userId,
    displayName,
    isHost,
  });

  return { token, livekitUrl: getLivekitUrl(), roomId: meeting.joinCode, role, endsAt: meeting.endsAt };
}
/**
 * Point d'entrée central des permissions : hôte et participants déjà
 * enregistrés rejoignent directement. Sinon, si requiresApproval est
 * activé, on crée une demande en salle d'attente au lieu de générer un
 * token — c'est getLobbyRequestStatus (poll côté client) qui finalisera
 * le join une fois l'hôte ayant répondu.
 */
export async function joinMeeting(input: JoinMeetingInput): Promise<JoinMeetingOutcome> {
  const [meeting, user] = await Promise.all([
        prisma.meeting.findUnique({
      where: { joinCode: input.joinCode },
      include: { room: true, participants: true, integrationSession: true },
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

  if (isHost || existingParticipant) {
    const result = await finalizeJoin(meeting, input.userId, user.name, isHost);
    return { waiting: false, ...result };
  }

  if (meeting.requiresApproval) {
    const lobbyRequest = await prisma.lobbyRequest.upsert({
      where: { meetingId_userId: { meetingId: meeting.id, userId: input.userId } },
      create: { meetingId: meeting.id, userId: input.userId },
      update: {},
    });
    // Si une demande précédente avait été refusée, on la relance en attente.
    if (lobbyRequest.status === LobbyRequestStatus.REJECTED) {
      await prisma.lobbyRequest.update({
        where: { id: lobbyRequest.id },
        data: { status: LobbyRequestStatus.PENDING, respondedAt: null },
      });
    }
    return { waiting: true, lobbyRequestId: lobbyRequest.id };
  }

  if (!meeting.allowGuest) {
    throw new ApiRequestError(403, "not_invited", "Tu n'es pas invité à cette réunion.");
  }

  const result = await finalizeJoin(meeting, input.userId, user.name, false);
  return { waiting: false, ...result };
}

/** Appelé en polling par le demandeur en salle d'attente. Génère le token
 * LiveKit à la volée dès que le statut passe à APPROVED (pas avant — on
 * ne crée pas de token pour une demande encore en attente). */
export async function getLobbyRequestStatus(
  lobbyRequestId: string,
  requestingUserId: string
): Promise<{ status: "PENDING" } | { status: "REJECTED" } | ({ status: "APPROVED" } & FinalizedJoin)> {
  const lobbyRequest = await prisma.lobbyRequest.findUnique({
    where: { id: lobbyRequestId },
    include: { meeting: { include: { room: true, integrationSession: true } }, user: true },
  });

  if (!lobbyRequest || lobbyRequest.userId !== requestingUserId) {
    throw new ApiRequestError(404, "lobby_request_not_found", "Demande introuvable.");
  }
  if (lobbyRequest.status === LobbyRequestStatus.PENDING) return { status: "PENDING" };
  if (lobbyRequest.status === LobbyRequestStatus.REJECTED) return { status: "REJECTED" };

  if (!lobbyRequest.meeting.room) {
    throw new ApiRequestError(404, "meeting_not_found", "Cette réunion n'existe plus.");
  }
  const result = await finalizeJoin(
    lobbyRequest.meeting,
    lobbyRequest.userId,
    lobbyRequest.user.name,
    false
  );
  return { status: "APPROVED", ...result };
}

export interface LobbyRequestItem {
  id: string;
  userId: string;
  name: string;
  requestedAt: Date;
}

/** Hôte uniquement — liste les demandes en attente pour affichage dans le panneau participants. */
export async function listLobbyRequests(
  joinCode: string,
  requestingUserId: string
): Promise<LobbyRequestItem[]> {
  const meeting = await prisma.meeting.findUnique({ where: { joinCode } });
  if (!meeting) {
    throw new ApiRequestError(404, "meeting_not_found", "Cette réunion n'existe pas.");
  }
  if (meeting.hostId !== requestingUserId) {
    throw new ApiRequestError(403, "forbidden", "Seul l'hôte peut voir la salle d'attente.");
  }

  const requests = await prisma.lobbyRequest.findMany({
    where: { meetingId: meeting.id, status: LobbyRequestStatus.PENDING },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return requests.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.user.name,
    requestedAt: r.createdAt,
  }));
}

export async function respondToLobbyRequest(
  lobbyRequestId: string,
  requestingUserId: string,
  approve: boolean
): Promise<void> {
  const lobbyRequest = await prisma.lobbyRequest.findUnique({
    where: { id: lobbyRequestId },
    include: { meeting: true },
  });
  if (!lobbyRequest) {
    throw new ApiRequestError(404, "lobby_request_not_found", "Demande introuvable.");
  }
  if (lobbyRequest.meeting.hostId !== requestingUserId) {
    throw new ApiRequestError(403, "forbidden", "Seul l'hôte peut répondre à cette demande.");
  }
  if (lobbyRequest.status !== LobbyRequestStatus.PENDING) {
    throw new ApiRequestError(400, "already_answered", "Cette demande a déjà été traitée.");
  }

  await prisma.lobbyRequest.update({
    where: { id: lobbyRequestId },
    data: {
      status: approve ? LobbyRequestStatus.APPROVED : LobbyRequestStatus.REJECTED,
      respondedAt: new Date(),
    },
  });
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
    include: { room: true, integrationSession: true },
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

    if (meeting.integrationSession) {
      void sendWebhook("meeting.ended", {
        external_session_id: meeting.integrationSession.externalSessionId,
        meeting_id: meeting.id,
      });
    }
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
  const meeting = await prisma.meeting.findUnique({
    where: { joinCode },
    include: { integrationSession: true },
  });

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

  if (meeting.integrationSession) {
    void sendWebhook("meeting.ended", {
      external_session_id: meeting.integrationSession.externalSessionId,
      meeting_id: meeting.id,
    });
  }
}