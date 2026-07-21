import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TimeEntry } from "../api/types";

export function useActiveTimer() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["active-timer"],
    queryFn: () => api.get<TimeEntry | null>("/time-entries/active"),
    refetchInterval: 15000,
  });

  const stop = useMutation({
    mutationFn: (id: string) => api.post(`/time-entries/${id}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-timer"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["task"] });
    },
  });

  return { activeTimer: query.data ?? null, isLoading: query.isLoading, stop };
}
