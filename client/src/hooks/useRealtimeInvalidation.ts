import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { socket } from "../lib/socket";

type UpdatePayload =
  | { scope: "dashboard" }
  | { scope: "projects" }
  | { scope: "project"; projectId: string }
  | { scope: "task"; taskId: string }
  | { scope: "users" };

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    function handleUpdate(payload: UpdatePayload) {
      switch (payload.scope) {
        case "dashboard":
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "projects":
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          break;
        case "project":
          queryClient.invalidateQueries({ queryKey: ["project", payload.projectId] });
          queryClient.invalidateQueries({ queryKey: ["project-tasks", payload.projectId] });
          break;
        case "task":
          queryClient.invalidateQueries({ queryKey: ["task", payload.taskId] });
          break;
        case "users":
          queryClient.invalidateQueries({ queryKey: ["users"] });
          break;
      }
    }

    socket.on("update", handleUpdate);
    return () => {
      socket.off("update", handleUpdate);
    };
  }, [queryClient]);
}
