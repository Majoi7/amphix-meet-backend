import { Router } from "express";
import { createRoom } from "../controllers/roomController";

const router = Router();

// POST /api/rooms — crée un nouvel identifiant de salle
router.post("/", createRoom);

export default router;
