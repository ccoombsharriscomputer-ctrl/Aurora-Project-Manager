import "dotenv/config";
import path from "path";
import http from "http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import projectRoutes from "./routes/projects";
import projectTypeRoutes from "./routes/projectTypes";
import checklistItemRoutes from "./routes/checklistItems";
import subProjectRoutes from "./routes/subProjects";
import taskRoutes from "./routes/tasks";
import timeEntryRoutes from "./routes/timeEntries";
import attachmentRoutes from "./routes/attachments";
import dashboardRoutes from "./routes/dashboard";
import reportRoutes from "./routes/reports";
import { attachRealtime } from "./lib/realtime";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

app.set("trust proxy", 1);

if (CLIENT_ORIGIN) {
  app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
}
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/project-types", projectTypeRoutes);
app.use("/api/checklist-items", checklistItemRoutes);
app.use("/api/sub-projects", subProjectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/time-entries", timeEntryRoutes);
app.use("/api/attachments", attachmentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
});

const server = http.createServer(app);
attachRealtime(server);

server.listen(PORT, () => {
  console.log(`Aurora Project Manager API listening on http://localhost:${PORT}`);
});
