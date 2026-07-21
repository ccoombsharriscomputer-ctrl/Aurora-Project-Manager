import { io, type Socket } from "socket.io-client";

export const socket: Socket = io(import.meta.env.PROD ? undefined : "http://localhost:4000", {
  withCredentials: true,
  autoConnect: true,
});
