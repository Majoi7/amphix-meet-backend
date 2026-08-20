import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import roomsRouter from "./routes/rooms";
import tokenRouter from "./routes/token";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// CORS : autorise localhost (dev) + ton futur domaine Vercel (prod)
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",");

app.use(helmet());
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/rooms", roomsRouter);
app.use("/api/token", tokenRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Amphix Meet backend en écoute sur le port ${PORT}`);
});