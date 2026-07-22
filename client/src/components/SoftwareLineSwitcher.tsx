import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CurrentUser, SoftwareLine } from "../api/types";
import { useAuth } from "../context/AuthContext";

export function SoftwareLineSwitcher() {
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: lines } = useQuery({
    queryKey: ["software-lines"],
    queryFn: () => api.get<SoftwareLine[]>("/software-lines"),
  });

  if (!user || !lines) return null;

  const effectiveLineId = user.activeSoftwareLineId ?? user.softwareLineId;
  const effectiveLine = lines.find((l) => l.id === effectiveLineId);

  if (user.role !== "ADMIN") {
    return <div className="sidebar-line-label">{effectiveLine?.name ?? ""}</div>;
  }

  async function handleChange(softwareLineId: string) {
    const updated = await api.patch<CurrentUser>("/auth/active-line", { softwareLineId });
    updateUser(updated);
    queryClient.invalidateQueries();
  }

  return (
    <select
      className="sidebar-line-select"
      value={effectiveLineId}
      onChange={(e) => handleChange(e.target.value)}
    >
      {lines.map((line) => (
        <option key={line.id} value={line.id}>
          {line.name}
        </option>
      ))}
    </select>
  );
}
