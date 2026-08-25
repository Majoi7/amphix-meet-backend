import type { Request, Response } from "express";
import { z } from "zod";
import * as bookingService from "../services/bookingService";

const createBookingSchema = z.object({
  otherPartyEmail: z.string().email(),
  subject: z.string().min(1).max(200),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
});

export async function createBooking(req: Request, res: Response): Promise<void> {
  const input = createBookingSchema.parse(req.body);
  const booking = await bookingService.createBooking({
    creatorId: req.user!.id,
    otherPartyEmail: input.otherPartyEmail,
    subject: input.subject,
    startsAt: new Date(input.startsAt),
    durationMinutes: input.durationMinutes,
  });
  res.status(201).json({ booking });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const bookings = await bookingService.listMyBookings(req.user!.id);
  res.status(200).json({ bookings });
}

const bookingIdParamSchema = z.object({ id: z.string().min(1) });

export async function confirmBooking(req: Request, res: Response): Promise<void> {
  const { id } = bookingIdParamSchema.parse(req.params);
  const booking = await bookingService.confirmBooking(id, req.user!.id);
  res.status(200).json({ booking });
}

export async function cancelBooking(req: Request, res: Response): Promise<void> {
  const { id } = bookingIdParamSchema.parse(req.params);
  const booking = await bookingService.cancelBooking(id, req.user!.id);
  res.status(200).json({ booking });
}

export async function startBooking(req: Request, res: Response): Promise<void> {
  const { id } = bookingIdParamSchema.parse(req.params);
  const result = await bookingService.startBookingSession(id, req.user!.id);
  res.status(200).json(result);
}