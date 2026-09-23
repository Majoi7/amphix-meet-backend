-- ════════════════════════════════════════════════════════════════════════
-- Amphix Meet — schéma PostgreSQL complet
-- ════════════════════════════════════════════════════════════════════════
--
-- GÉNÉRÉ À PARTIR DE `backend/prisma/schema.prisma` (état actuel, 10 modèles).
-- Écrit dans le style exact de `prisma migrate` : mêmes noms de contraintes,
-- mêmes types, mêmes actions référentielles, même ordre (enums → tables →
-- index → clés étrangères).
--
-- CE FICHIER N'A PAS ÉTÉ EXÉCUTÉ. Il est destiné à une relecture.
--
-- ── PORTÉE ─────────────────────────────────────────────────────────────
-- Crée UNIQUEMENT le schéma métier Amphix Meet dans une base vide.
-- Ne contient AUCUN : DROP DATABASE, DROP SCHEMA, DROP TABLE, TRUNCATE,
-- DELETE, ni aucune instruction destructive.
-- Ne crée PAS la table `_prisma_migrations` — voir la note en fin de fichier.
--
-- ── TYPES POSTGRESQL UTILISÉS ──────────────────────────────────────────
--   String    → TEXT
--   Boolean   → BOOLEAN
--   Int       → INTEGER
--   DateTime  → TIMESTAMP(3)
--   Json      → JSONB
--   cuid()    → TEXT, sans défaut en base (généré par le client Prisma)
--   @updatedAt → TIMESTAMP(3) NOT NULL, sans défaut (écrit par le client)
--   @default(now()) → DEFAULT CURRENT_TIMESTAMP
-- ════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- ENUMS (7)
-- ───────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'TEACHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('HOST', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "LobbyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');


-- ───────────────────────────────────────────────────────────────────────
-- TABLES (10)
-- ───────────────────────────────────────────────────────────────────────

-- CreateTable — model User
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model RefreshToken
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable — model VerificationToken
CREATE TABLE "verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

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
-- CONTRAINTES UNIQUE (12)
-- Prisma émet les @@unique sous forme d'index uniques, pas de contraintes
-- de table — d'où `CREATE UNIQUE INDEX` et non `ADD CONSTRAINT ... UNIQUE`.
-- ───────────────────────────────────────────────────────────────────────

-- CreateIndex — User.email @unique
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex — RefreshToken.tokenHash @unique
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex — VerificationToken.tokenHash @unique
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

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
-- INDEX SIMPLES (8)
-- ───────────────────────────────────────────────────────────────────────

-- CreateIndex — RefreshToken @@index([userId])
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex — VerificationToken @@index([userId])
CREATE INDEX "verification_tokens_userId_idx" ON "verification_tokens"("userId");

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
-- CLÉS ÉTRANGÈRES (13)
-- Ajoutées APRÈS toutes les tables : l'ordre de création des tables est donc
-- sans importance, et aucune dépendance circulaire ne peut bloquer.
-- Toutes portent ON UPDATE CASCADE (défaut Prisma).
-- ON DELETE suit `onDelete` de schema.prisma ; à défaut, Prisma applique
-- RESTRICT pour une relation obligatoire et SET NULL pour une optionnelle.
-- ───────────────────────────────────────────────────────────────────────

-- AddForeignKey — RefreshToken.user (onDelete: Cascade)
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — VerificationToken.user (onDelete: Cascade)
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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


-- ════════════════════════════════════════════════════════════════════════
-- NOTES DE MISE EN ŒUVRE — à lire avant toute exécution
-- ════════════════════════════════════════════════════════════════════════
--
-- 1. `_prisma_migrations` N'EST PAS CRÉÉE ICI.
--    Ce fichier écrit le schéma directement, sans passer par le moteur de
--    migration. Conséquence : `prisma migrate status` considérera la base
--    comme n'ayant AUCUNE migration appliquée, et proposera de rejouer
--    `20260820193155_init_auth` — qui échouerait, les tables existant déjà.
--
--    Si l'objectif est de garder `prisma migrate` utilisable par la suite,
--    il faudra soit marquer la migration comme appliquée
--    (`prisma migrate resolve --applied 20260820193155_init_auth`), soit
--    générer à la place une vraie migration pour les 7 modèles manquants.
--    Ce choix n'est pas tranché ici.
--
-- 2. `cuid()` et `@updatedAt` sont CLIENT-side.
--    Aucun défaut n'est posé en base pour `id` ni pour `updatedAt` : c'est
--    Prisma qui les remplit. Une insertion faite à la main en SQL doit donc
--    fournir ces deux colonnes explicitement.
--
-- 3. Les identifiants sont en camelCase et DOIVENT rester entre guillemets.
--    `@@map` ne renomme que les TABLES ; les colonnes gardent le nom des
--    champs Prisma. `"userId"` sans guillemets deviendrait `userid`.
--
-- 4. Ce fichier ne crée aucune donnée, aucune extension, aucun rôle, et ne
--    touche ni à `auth`, ni à `storage`, ni à aucun schéma Supabase interne.
--    Il n'écrit que dans le schéma courant (`public` par défaut).
-- ════════════════════════════════════════════════════════════════════════
