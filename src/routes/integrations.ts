import { Router } from "express";
import * as integrationController from "../controllers/integrationController";
import { requireIntegrationSecret } from "../middleware/integrationAuth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireIntegrationSecret);

router.post("/amphix/sessions", apiRateLimiter, asyncHandler(integrationController.createSession));

export default router;