import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { socket } from "../lib/socket";

type UpdatePayload =
  | { scope: "dashboard" }
  | { scope: "projects" }
  | { scope: "project"; projectId: string }
  | { scope: "sub-project"; subProjectId: string }
  | { scope: "task"; taskId: string }
  | { scope: "users" }
  | { scope: "project-types" }
  | { scope: "products" }
  | { scope: "access-requests" };

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
          queryClient.invalidateQueries({ queryKey: ["project-sub-projects", payload.projectId] });
          break;
        case "sub-project":
          queryClient.invalidateQueries({ queryKey: ["sub-project", payload.subProjectId] });
          queryClient.invalidateQueries({ queryKey: ["sub-project-tasks", payload.subProjectId] });
          break;
        case "task":
          queryClient.invalidateQueries({ queryKey: ["task", payload.taskId] });
          break;
        case "users":
          queryClient.invalidateQueries({ queryKey: ["users"] });
          break;
        case "project-types":
          queryClient.invalidateQueries({ queryKey: ["project-types"] });
          break;
        case "products":
          queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
          queryClient.invalidateQueries({ queryKey: ["task-templates"] });
          break;
        case "access-requests":
          queryClient.invalidateQueries({ queryKey: ["access-requests"] });
          break;
      }
    }

    socket.on("update", handleUpdate);
    return () => {
      socket.off("update", handleUpdate);
    };
  }, [queryClient]);
}
