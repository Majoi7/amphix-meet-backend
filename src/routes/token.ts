import { Router } from "express";
import { issueToken } from "../controllers/tokenController";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

// POST /api/token — génère un token LiveKit pour rejoindre une salle
router.post("/", apiRateLimiter, asyncHandler(issueToken));

export default router;
