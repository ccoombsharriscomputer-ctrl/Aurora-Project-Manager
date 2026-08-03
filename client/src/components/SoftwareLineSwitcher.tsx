import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CurrentUser } from "../api/types";
import { useAuth } from "../context/AuthContext";

// The option list is exactly what the server already decided this user may switch into
// (every line for an admin, home + granted for a Project Lead/Member) — no separate fetch
// or client-side filtering needed.
export function SoftwareLineSwitcher() {
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();

  if (!user) return null;

  const lines = user.accessibleSoftwareLines;
  const effectiveLineId = user.activeSoftwareLineId ?? user.softwareLineId;

  if (lines.length <= 1) {
    const effectiveLine = lines.find((l) => l.id === effectiveLineId) ?? lines[0];
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
