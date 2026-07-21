import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AdminUser } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../utils/format";

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<AdminUser[]>("/users"),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<AdminUser, "role" | "active">> }) =>
      api.patch(`/users/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  if (isLoading || !users) {
    return <div className="muted">Loading users…</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Users</h1>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={u.id === me?.id}
                    onChange={(e) => updateUser.mutate({ id: u.id, data: { role: e.target.value as AdminUser["role"] } })}
                    style={{ width: "auto" }}
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </td>
                <td>{u.active ? "Active" : "Deactivated"}</td>
                <td>{formatDate(u.createdAt)}</td>
                <td>
                  <button
                    className="btn btn-sm"
                    disabled={u.id === me?.id}
                    onClick={() => updateUser.mutate({ id: u.id, data: { active: !u.active } })}
                  >
                    {u.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
