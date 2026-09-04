import { Router } from "express";
import * as authController from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

// Routes publiques avec limiteur spécifique pour l'authentification
router.post("/register", authRateLimiter, asyncHandler(authController.register));
router.post("/login", authRateLimiter, asyncHandler(authController.login));
router.post("/refresh", asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));
router.post("/verify-email", asyncHandler(authController.verifyEmail));
router.post("/forgot-password", authRateLimiter, asyncHandler(authController.forgotPassword));
router.post("/reset-password", authRateLimiter, asyncHandler(authController.resetPassword));

// Routes protégées — nécessitent un access token valide
router.get("/me", requireAuth, asyncHandler(authController.me));
router.patch("/me", requireAuth, asyncHandler(authController.updateMe));

export default router;
