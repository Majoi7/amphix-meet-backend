import type { Request, Response } from "express";
import { z } from "zod";
import * as integrationService from "../services/integrationService";

const personSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
});

const createSessionSchema = z.object({
  external_session_id: z.string().min(1).max(200),
  teacher: personSchema,
  student: personSchema,
  subject: z.string().min(1).max(200),
  starts_at: z.string().datetime().optional(), // accepté mais pas encore utilisé, voir note
  duration_minutes: z.number().int().min(1).max(24 * 60).optional(),
});

export async function createSession(req: Request, res: Response): Promise<void> {
  const input = createSessionSchema.parse(req.body ?? {});

  const result = await integrationService.createAmphixSession({
    externalSessionId: input.external_session_id,
    teacher: input.teacher,
    student: input.student,
    subject: input.subject,
    durationMinutes: input.duration_minutes,
  });

  res.status(201).json({
    meeting_id: result.meetingId,
    join_url_teacher: result.joinUrlTeacher,
    join_url_student: result.joinUrlStudent,
    starts_at: result.startsAt,
    ends_at: result.endsAt,
  });
}