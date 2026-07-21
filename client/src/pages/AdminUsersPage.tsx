import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AdminUser, UserRole } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";
import { formatDate } from "../utils/format";

function CreateUserForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  const [error, setError] = useState<string | null>(null);

  const createUser = useMutation({
    mutationFn: () => api.post<AdminUser>("/users", { name, email, password, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setName("");
      setEmail("");
      setPassword("");
      setRole("MEMBER");
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Add user
      </button>
    );
  }

  return (
    <form
      className="card"
      style={{ marginBottom: 16 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        createUser.mutate();
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Name</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Initial password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="MEMBER">Member</option>
            <option value="PROJECT_LEAD">Project Lead</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={createUser.isPending}>
          Create user
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

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
        <CreateUserForm />
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
                    <option value="PROJECT_LEAD">Project Lead</option>
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
