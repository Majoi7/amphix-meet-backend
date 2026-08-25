import { Router } from "express";
import * as bookingController from "../controllers/bookingController";
import { requireAuth } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);

router.post("/", apiRateLimiter, asyncHandler(bookingController.createBooking));
router.get("/mine", asyncHandler(bookingController.listMine));
router.post("/:id/confirm", asyncHandler(bookingController.confirmBooking));
router.post("/:id/cancel", asyncHandler(bookingController.cancelBooking));
router.post("/:id/start", apiRateLimiter, asyncHandler(bookingController.startBooking));

export default router;