import { BookingStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiRequestError } from "../middleware/errorHandler";
import { createMeeting } from "./meetingService";

const DEFAULT_DURATION_MINUTES = 180; // cohérent avec la règle "séances de 3h"

/**
 * Le message UNIQUE des échecs « cette adresse ne mène pas à une réservation
 * possible ». Il couvre deux causes — adresse sans compte, ou compte du même
 * rôle que le demandeur — sans dire laquelle, pour que la réponse ne serve
 * pas à vérifier si une adresse est inscrite (voir `createBooking`).
 *
 * Il énonce les deux règles plutôt que de les taire : c'est ce qui le rend
 * encore utile à quelqu'un qui s'est simplement trompé d'adresse ou de
 * destinataire.
 */
const RECIPIENT_UNAVAILABLE =
  "Impossible de réserver avec cette adresse email : une réservation se fait entre un élève et un enseignant, et la personne doit avoir un compte Amphix Meet.";

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

  // ── Ne pas faire de cette fonction un annuaire ────────────────────────
  //
  // Cet endpoint cherche un compte par adresse email. Tel quel, il
  // permettrait donc à n'importe quel utilisateur connecté de tester si une
  // adresse donnée est inscrite : deux réponses distinctes — « aucun compte
  // avec cet email » (404) et « la réservation doit se faire entre un élève
  // et un enseignant » (400) — se comparent, et disent laquelle est vraie.
  //
  // Le remède complet — répondre la même chose dans tous les cas — n'est pas
  // disponible ici : une réservation RÉUSSIE prouve forcément que le compte
  // existe, puisque c'est la fonction même de la réservation. Le retirer
  // demanderait un parcours d'invitation par email (on écrit à l'adresse,
  // elle répond ou non), qui n'existe pas et sortirait du périmètre.
  //
  // Ce qui est retiré, c'est la réponse qui ne crée RIEN. Les deux échecs
  // « cette adresse ne mène pas à une réservation possible » sont réunis en
  // une seule réponse — même statut, même code, même texte — qui ne dit pas
  // laquelle des deux causes s'applique. Le texte reste utile dans les deux
  // cas : il énonce la règle de rôle ET l'exigence de compte, donc un
  // enseignant qui saisit l'adresse d'un collègue comprend son erreur, et
  // quelqu'un qui se trompe d'adresse sait quoi vérifier. Ce qui disparaît,
  // c'est la CONFIRMATION.
  //
  // Les deux refus qui restent distincts ne disent rien de l'adresse
  // saisie : celui de l'administrateur ne dépend que de son propre rôle, et
  // celui de l'auto-réservation que de sa propre adresse — vérifiés avant
  // ou en dehors de toute conclusion sur l'existence d'un tiers.
  if (creator.role === UserRole.ADMIN) {
    throw new ApiRequestError(
      400,
      "invalid_roles",
      "Les réservations se font entre un élève et un enseignant."
    );
  }
  if (otherParty && otherParty.id === creator.id) {
    throw new ApiRequestError(400, "invalid_target", "Tu ne peux pas te réserver toi-même.");
  }
  if (!otherParty || otherParty.role === creator.role) {
    throw new ApiRequestError(404, "recipient_unavailable", RECIPIENT_UNAVAILABLE);
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