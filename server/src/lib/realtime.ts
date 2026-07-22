import type { Server as HttpServer } from "http";
import { Server } from "socket.io";

export type UpdateScope =
  | { scope: "dashboard" }
  | { scope: "projects" }
  | { scope: "project"; projectId: string }
  | { scope: "sub-project"; subProjectId: string }
  | { scope: "task"; taskId: string }
  | { scope: "users" }
  | { scope: "project-types" }
  | { scope: "modules" }
  | { scope: "access-requests" };

let io: Server | null = null;

export function attachRealtime(httpServer: HttpServer): Server {
  const clientOrigin = process.env.CLIENT_ORIGIN;
  io = new Server(httpServer, {
    cors: clientOrigin ? { origin: clientOrigin, credentials: true } : undefined,
  });
  return io;
}

export function emitUpdate(payload: UpdateScope) {
  io?.emit("update", payload);
}
