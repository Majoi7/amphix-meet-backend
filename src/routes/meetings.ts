import { Router } from "express";
import * as meetingController from "../controllers/meetingController";
import * as whiteboardController from "../controllers/whiteboardController";
import { requireAuth } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth); // toutes les routes meetings exigent une session valide

router.post("/", apiRateLimiter, asyncHandler(meetingController.createMeeting));
router.get("/mine", asyncHandler(meetingController.listMine)); // AVANT /:joinCode !

// Ces deux routes commencent par un segment fixe ("lobby-requests") donc
// ne collisionnent pas avec /:joinCode (1 seul segment) — mais on les
// garde avant par cohérence avec le reste du fichier.
router.get(
  "/lobby-requests/:id/status",
  asyncHandler(meetingController.getLobbyStatus)
);
router.post(
  "/lobby-requests/:id/approve",
  asyncHandler(meetingController.approveLobbyRequest)
);
router.post(
  "/lobby-requests/:id/reject",
  asyncHandler(meetingController.rejectLobbyRequest)
);

router.get("/:joinCode", asyncHandler(meetingController.getMeeting));
router.get("/:joinCode/lobby", asyncHandler(meetingController.listLobby));
router.get("/:joinCode/whiteboard", asyncHandler(whiteboardController.getWhiteboard));
router.put("/:joinCode/whiteboard", asyncHandler(whiteboardController.saveWhiteboard));
router.post("/:joinCode/join", apiRateLimiter, asyncHandler(meetingController.joinMeeting));
router.post("/:joinCode/end", asyncHandler(meetingController.endMeeting));
router.post(
  "/:joinCode/participants/:userId/mute",
  asyncHandler(meetingController.muteParticipant)
);
router.post(
  "/:joinCode/participants/:userId/remove",
  asyncHandler(meetingController.removeParticipant)
);

export default router;
