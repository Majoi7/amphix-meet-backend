import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import authRouter from "./routes/auth";
import meetingsRouter from "./routes/meetings";
import bookingsRouter from "./routes/bookings";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { startMeetingScheduler } from "./jobs/meetingScheduler";
import integrationsRouter from "./routes/integrations";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",");

app.use(helmet());
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true,
  })
);
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "amphix-meet" });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/meetings", meetingsRouter);
app.use("/api/v1/bookings", bookingsRouter);
app.use("/api/v1/integrations", integrationsRouter);

// ⚠️ Phase 2 : les anciennes routes V1 /api/rooms et /api/token (non
// authentifiées) ont été RETIRÉES ici — remplacées par /api/v1/meetings,
// intégralement protégées par requireAuth. Les fichiers routes/rooms.ts
// et routes/token.ts restent dans le repo (non montés, orphelins) —
// tu peux les supprimer une fois la Phase 2 confirmée stable.

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Amphix Meet backend en écoute sur http://localhost:${PORT}`);
  startMeetingScheduler();
});