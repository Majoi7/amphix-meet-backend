-- ════════════════════════════════════════════════════════════════════════
-- Amphix Meet — migration de rattrapage (baseline Prisma)
-- ════════════════════════════════════════════════════════════════════════
--
-- COMPLÉMENT DE `20260820193155_init_auth`.
--
-- Cette migration complète l'historique Prisma pour qu'il décrive
-- l'intégralité de `schema.prisma`. La migration `init_auth` couvre
-- l'authentification (`users`, `refresh_tokens`, `verification_tokens`) ;
-- celle-ci couvre les 7 modèles métier restants.
--
-- ── ⚠️ NE PAS EXÉCUTER CONTRE SUPABASE ─────────────────────────────────
--
-- Les objets ci-dessous EXISTENT DÉJÀ dans Supabase. Ils ont été créés
-- directement avec `backend/prisma/supabase-schema.sql`, sans passer par
-- le moteur de migration.
--
-- Ce fichier est un ENREGISTREMENT HISTORIQUE, pas une instruction à
-- exécuter. Il est destiné à être marqué comme appliqué :
--
--     prisma migrate resolve --applied 20260923103000_add_meeting_models
--
-- `resolve --applied` n'exécute PAS ce SQL : Prisma ne lit le fichier que
-- pour en extraire le NOM et le CHECKSUM. Le rejouer produirait des
-- erreurs « already exists ».
--
-- ── PORTÉE ─────────────────────────────────────────────────────────────
--
-- Contenu, strictement le complément de `20260820193155_init_auth` :
--
--     5 enums   ·  7 tables  ·  57 colonnes
--     9 index uniques  ·  6 index simples  ·  11 clés étrangères
--
-- N'est présent dans ce fichier AUCUN objet déjà créé par `init_auth` :
-- pas de `users`, `refresh_tokens`, `verification_tokens`, ni leurs
-- index ou clés étrangères. Les deux migrations sont DISJOINTES.
--
-- ── SÉCURITÉ ───────────────────────────────────────────────────────────
--
-- Aucun DROP, aucun TRUNCATE, aucun DELETE, aucun UPDATE, aucun INSERT.
-- Aucun ALTER sur une table existante. Aucun objet Supabase interne
-- (auth / storage / realtime / vault). Aucune donnée.
--
-- ── TYPES POSTGRESQL ───────────────────────────────────────────────────
--
--   String    → TEXT
--   Boolean   → BOOLEAN
--   Int       → INTEGER
--   DateTime  → TIMESTAMP(3)
--   Json      → JSONB
--   cuid()    → TEXT, sans défaut en base (généré par le client Prisma)
--   @updatedAt → TIMESTAMP(3) NOT NULL, sans défaut (écrit par le client)
--   @default(now()) → DEFAULT CURRENT_TIMESTAMP
--
-- Les identifiants sont en camelCase et DOIVENT rester entre guillemets.
-- ════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- ENUMS (5)
-- ───────────────────────────────────────────────────────────────────────

-- CreateEnum — model Meeting.status
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum — model Room.status
CREATE TYPE "RoomStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED');

-- CreateEnum — model MeetingParticipant.role
CREATE TYPE "ParticipantRole" AS ENUM ('HOST', 'PARTICIPANT');

-- CreateEnum — model Booking.status
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum — model LobbyRequest.status
CREATE TYPE "LobbyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');


-- ───────────────────────────────────────────────────────────────────────
-- TABLES (7)
-- ───────────────────────────────────────────────────────────────────────

-- CreateTable — model Meeting
-- `globalPinnedParticipantId` n'a AUCUNE clé étrangère : c'est un identifiant
-- de participant LiveKit, pas une référence à `users`. Il est donc TEXT nu,
-- exactement comme dans schema.prisma.
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "allowGuest" BOOLEAN NOT NULL DEFAULT true,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "globalPinnedParticipantId" TEXT,
    "globalPinnedTrackSource" TEXT,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model Room
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'livekit',
    "externalRoomName" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model MeetingParticipant
CREATE TABLE "meeting_participants" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model Booking
-- Clé étrangère NOTABLE : `meetingId` est optionnel (Meeting?) et ne porte
-- aucun `onDelete` explicite. Prisma applique donc SET NULL, et non CASCADE —
-- supprimer une réunion détache la réservation au lieu de la supprimer.
-- `createdById` n'a AUCUNE clé étrangère : c'est un simple identifiant
-- d'auteur, sans relation Prisma déclarée.
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model LobbyRequest
CREATE TABLE "lobby_requests" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "LobbyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "lobby_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model Whiteboard
CREATE TABLE "whiteboards" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{"strokes": []}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whiteboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model IntegrationSession
CREATE TABLE "integration_sessions" (
    "id" TEXT NOT NULL,
    "externalSessionId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sessions_pkey" PRIMARY KEY ("id")
);


-- ───────────────────────────────────────────────────────────────────────
-- CONTRAINTES UNIQUE (9)
-- Prisma émet les @@unique sous forme d'index uniques, pas de contraintes
-- de table — d'où `CREATE UNIQUE INDEX` et non `ADD CONSTRAINT ... UNIQUE`.
-- ───────────────────────────────────────────────────────────────────────

-- CreateIndex — Meeting.joinCode @unique
CREATE UNIQUE INDEX "meetings_joinCode_key" ON "meetings"("joinCode");

-- CreateIndex — Room.meetingId @unique
CREATE UNIQUE INDEX "rooms_meetingId_key" ON "rooms"("meetingId");

-- CreateIndex — Room.externalRoomName @unique
CREATE UNIQUE INDEX "rooms_externalRoomName_key" ON "rooms"("externalRoomName");

-- CreateIndex — MeetingParticipant @@unique([meetingId, userId])
CREATE UNIQUE INDEX "meeting_participants_meetingId_userId_key" ON "meeting_participants"("meetingId", "userId");

-- CreateIndex — Booking.meetingId @unique
CREATE UNIQUE INDEX "bookings_meetingId_key" ON "bookings"("meetingId");

-- CreateIndex — LobbyRequest @@unique([meetingId, userId])
CREATE UNIQUE INDEX "lobby_requests_meetingId_userId_key" ON "lobby_requests"("meetingId", "userId");

-- CreateIndex — Whiteboard.meetingId @unique
CREATE UNIQUE INDEX "whiteboards_meetingId_key" ON "whiteboards"("meetingId");

-- CreateIndex — IntegrationSession.externalSessionId @unique
CREATE UNIQUE INDEX "integration_sessions_externalSessionId_key" ON "integration_sessions"("externalSessionId");

-- CreateIndex — IntegrationSession.meetingId @unique
CREATE UNIQUE INDEX "integration_sessions_meetingId_key" ON "integration_sessions"("meetingId");


-- ───────────────────────────────────────────────────────────────────────
-- INDEX SIMPLES (6)
-- ───────────────────────────────────────────────────────────────────────

-- CreateIndex — Meeting @@index([hostId])
CREATE INDEX "meetings_hostId_idx" ON "meetings"("hostId");

-- CreateIndex — MeetingParticipant @@index([meetingId])
CREATE INDEX "meeting_participants_meetingId_idx" ON "meeting_participants"("meetingId");

-- CreateIndex — MeetingParticipant @@index([userId])
CREATE INDEX "meeting_participants_userId_idx" ON "meeting_participants"("userId");

-- CreateIndex — Booking @@index([studentId])
CREATE INDEX "bookings_studentId_idx" ON "bookings"("studentId");

-- CreateIndex — Booking @@index([teacherId])
CREATE INDEX "bookings_teacherId_idx" ON "bookings"("teacherId");

-- CreateIndex — LobbyRequest @@index([meetingId])
CREATE INDEX "lobby_requests_meetingId_idx" ON "lobby_requests"("meetingId");


-- ───────────────────────────────────────────────────────────────────────
-- CLÉS ÉTRANGÈRES (11)
-- Ajoutées APRÈS toutes les tables. Les 5 FK référençant `users` sont donc
-- créées après que `20260820193155_init_auth` a créé cette table — l'ordre
-- chronologique des deux migrations est correct.
-- Toutes portent ON UPDATE CASCADE (défaut Prisma).
-- ON DELETE suit `onDelete` de schema.prisma ; à défaut, Prisma applique
-- RESTRICT pour une relation obligatoire et SET NULL pour une optionnelle.
-- ───────────────────────────────────────────────────────────────────────

-- AddForeignKey — Meeting.host (onDelete: Cascade)
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — Room.meeting (onDelete: Cascade)
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — MeetingParticipant.meeting (onDelete: Cascade)
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — MeetingParticipant.user (onDelete: Cascade)
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — Booking.meeting (relation optionnelle, AUCUN onDelete explicite → SET NULL)
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — Booking.student (onDelete: Cascade)
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — Booking.teacher (onDelete: Cascade)
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — LobbyRequest.meeting (onDelete: Cascade)
ALTER TABLE "lobby_requests" ADD CONSTRAINT "lobby_requests_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — LobbyRequest.user (onDelete: Cascade)
ALTER TABLE "lobby_requests" ADD CONSTRAINT "lobby_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — Whiteboard.meeting (onDelete: Cascade)
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — IntegrationSession.meeting (onDelete: Cascade)
ALTER TABLE "integration_sessions" ADD CONSTRAINT "integration_sessions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
