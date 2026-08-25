import { BookingStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiRequestError } from "../middleware/errorHandler";
import { createMeeting } from "./meetingService";

const DEFAULT_DURATION_MINUTES = 180; // cohérent avec la règle "séances de 3h"

export interface CreateBookingInput {
  creatorId: string;
  otherPartyEmail: string;
  subject: string;
  startsAt: Date;
  durationMinutes?: number;
}

export interface BookingSummary {
  id: string;
  subject: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  status: BookingStatus;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  createdById: string;
  meetingJoinCode: string | null;
}

function toSummary(booking: {
  id: string;
  subject: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  status: BookingStatus;
  studentId: string;
  student: { name: string };
  teacherId: string;
  teacher: { name: string };
  createdById: string;
  meeting: { joinCode: string } | null;
}): BookingSummary {
  return {
    id: booking.id,
    subject: booking.subject,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    durationMinutes: booking.durationMinutes,
    status: booking.status,
    studentId: booking.studentId,
    studentName: booking.student.name,
    teacherId: booking.teacherId,
    teacherName: booking.teacher.name,
    createdById: booking.createdById,
    meetingJoinCode: booking.meeting?.joinCode ?? null,
  };
}

/**
 * Crée une réservation entre l'utilisateur courant et une autre personne
 * (retrouvée par email). Détermine automatiquement qui est l'élève et qui
 * est le prof à partir de leurs rôles respectifs — refuse si les deux ont
 * le même rôle (deux élèves ou deux profs ne peuvent pas se réserver
 * mutuellement une séance).
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingSummary> {
  const [creator, otherParty] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.creatorId } }),
    prisma.user.findUnique({ where: { email: input.otherPartyEmail.toLowerCase().trim() } }),
  ]);

  if (!creator) {
    throw new ApiRequestError(401, "unauthorized", "Utilisateur introuvable.");
  }
  if (!otherParty) {
    throw new ApiRequestError(
      404,
      "user_not_found",
      "Aucun compte trouvé avec cet email. La personne doit d'abord créer un compte Amphix Meet."
    );
  }
  if (otherParty.id === creator.id) {
    throw new ApiRequestError(400, "invalid_target", "Tu ne peux pas te réserver toi-même.");
  }
  if (creator.role === otherParty.role || creator.role === UserRole.ADMIN) {
    throw new ApiRequestError(
      400,
      "invalid_roles",
      "Une réservation doit se faire entre un élève et un enseignant."
    );
  }

  const isCreatorStudent = creator.role === UserRole.STUDENT;
  const studentId = isCreatorStudent ? creator.id : otherParty.id;
  const teacherId = isCreatorStudent ? otherParty.id : creator.id;

  const durationMinutes = Math.max(
    input.durationMinutes ?? DEFAULT_DURATION_MINUTES,
    DEFAULT_DURATION_MINUTES
  );
  const endsAt = new Date(input.startsAt.getTime() + durationMinutes * 60_000);

  if (input.startsAt.getTime() < Date.now()) {
    throw new ApiRequestError(400, "invalid_date", "La date de la séance doit être dans le futur.");
  }

  const booking = await prisma.booking.create({
    data: {
      studentId,
      teacherId,
      createdById: creator.id,
      subject: input.subject.trim(),
      startsAt: input.startsAt,
      endsAt,
      durationMinutes,
      status: BookingStatus.PENDING,
    },
    include: { student: true, teacher: true, meeting: true },
  });

  return toSummary(booking);
}

export async function listMyBookings(userId: string): Promise<BookingSummary[]> {
  const bookings = await prisma.booking.findMany({
    where: { OR: [{ studentId: userId }, { teacherId: userId }] },
    include: { student: true, teacher: true, meeting: true },
    orderBy: { startsAt: "asc" },
  });
  return bookings.map(toSummary);
}

async function getBookingOrThrow(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { student: true, teacher: true, meeting: true },
  });
  if (!booking) {
    throw new ApiRequestError(404, "booking_not_found", "Cette réservation n'existe pas.");
  }
  return booking;
}

function requireParty(booking: { studentId: string; teacherId: string }, userId: string): void {
  if (booking.studentId !== userId && booking.teacherId !== userId) {
    throw new ApiRequestError(403, "forbidden", "Tu n'es pas concerné par cette réservation.");
  }
}

/** Seule l'AUTRE partie (pas celle qui a créé la demande) peut confirmer. */
export async function confirmBooking(bookingId: string, userId: string): Promise<BookingSummary> {
  const booking = await getBookingOrThrow(bookingId);
  requireParty(booking, userId);

  if (booking.createdById === userId) {
    throw new ApiRequestError(
      400,
      "cannot_confirm_own_booking",
      "Tu ne peux pas confirmer ta propre demande — c'est à l'autre personne de le faire."
    );
  }
  if (booking.status !== BookingStatus.PENDING) {
    throw new ApiRequestError(400, "invalid_status", "Cette réservation n'est plus en attente.");
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.CONFIRMED },
    include: { student: true, teacher: true, meeting: true },
  });
  return toSummary(updated);
}

/** Élève ou prof peuvent annuler, tant que la séance n'a pas commencé. */
export async function cancelBooking(bookingId: string, userId: string): Promise<BookingSummary> {
  const booking = await getBookingOrThrow(bookingId);
  requireParty(booking, userId);

  if (booking.status === BookingStatus.COMPLETED || booking.status === BookingStatus.IN_PROGRESS) {
    throw new ApiRequestError(
      400,
      "invalid_status",
      "Impossible d'annuler une séance déjà commencée ou terminée."
    );
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.CANCELLED },
    include: { student: true, teacher: true, meeting: true },
  });
  return toSummary(updated);
}

/**
 * Démarre effectivement la séance : crée la Meeting (si pas déjà fait —
 * idempotent, gère le cas où le prof ET l'élève cliquent "Rejoindre"
 * presque en même temps) avec l'élève pré-autorisé, et renvoie le
 * joinCode pour que le frontend rejoigne comme une réunion normale.
 */
export async function startBookingSession(
  bookingId: string,
  userId: string
): Promise<{ joinCode: string }> {
  const booking = await getBookingOrThrow(bookingId);
  requireParty(booking, userId);

  if (booking.meeting) {
    return { joinCode: booking.meeting.joinCode };
  }

  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new ApiRequestError(
      400,
      "not_confirmed",
      "Cette réservation doit être confirmée avant de pouvoir démarrer."
    );
  }

  const meeting = await createMeeting({
    hostId: booking.teacherId,
    title: booking.subject,
    allowGuest: false, // privé : seuls élève + prof peuvent rejoindre
    durationMinutes: booking.durationMinutes,
    preRegisteredParticipantIds: [booking.studentId],
  });

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: BookingStatus.IN_PROGRESS, meetingId: meeting.meetingId },
  });

  return { joinCode: meeting.joinCode };
}