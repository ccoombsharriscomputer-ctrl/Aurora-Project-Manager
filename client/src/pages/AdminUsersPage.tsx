import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { AccessRequest, AdminUser, UserRole } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";
import { formatDate } from "../utils/format";

interface CreateUserPrefill {
  accessRequestId: string;
  name: string;
  email: string;
}

function CreateUserForm({
  prefill,
  onDone,
}: {
  prefill: CreateUserPrefill | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefill) {
      setOpen(true);
      setName(prefill.name);
      setEmail(prefill.email);
      setError(null);
    }
  }, [prefill]);

  const createUser = useMutation({
    mutationFn: () =>
      api.post<AdminUser>("/users", {
        name,
        email,
        password,
        role,
        accessRequestId: prefill?.accessRequestId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      if (prefill) queryClient.invalidateQueries({ queryKey: ["access-requests"] });
      setName("");
      setEmail("");
      setPassword("");
      setRole("MEMBER");
      setOpen(false);
      setError(null);
      onDone();
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        {t("adminUsers.addUser")}
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
          <label>{t("common.name")}</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("common.email")}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("adminUsers.initialPassword")}</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label>{t("common.role")}</label>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="MEMBER">{t("common.roleMember")}</option>
            <option value="PROJECT_LEAD">{t("common.roleProjectLead")}</option>
            <option value="ADMIN">{t("common.roleAdmin")}</option>
          </select>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={createUser.isPending}>
          {t("adminUsers.createUser")}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            setOpen(false);
            onDone();
          }}
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function PendingAccessRequests({
  onApprove,
}: {
  onApprove: (prefill: CreateUserPrefill) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [denyErrors, setDenyErrors] = useState<Record<string, string>>({});

  const { data: requests } = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => api.get<AccessRequest[]>("/access-requests"),
  });

  const deny = useMutation({
    mutationFn: (id: string) => api.post(`/access-requests/${id}/deny`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["access-requests"] });
      setDenyErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onError: (err, id) => setDenyErrors((prev) => ({ ...prev, [id]: extractErrorMessage(err) })),
  });

  if (!requests || requests.length === 0) {
    return null;
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="section-title">{t("adminUsers.pendingAccessRequests")}</div>
      {requests.map((r) => (
        <div key={r.id}>
          <div className="task-list-item">
            <span>
              {r.name} <span className="muted">({r.email})</span>
              {r.message && <span className="muted"> — {r.message}</span>}
            </span>
            <span className="gap-8">
              <span className="muted">{formatDate(r.createdAt)}</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onApprove({ accessRequestId: r.id, name: r.name, email: r.email })}
              >
                {t("adminUsers.approve")}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => deny.mutate(r.id)}>
                {t("adminUsers.deny")}
              </button>
            </span>
          </div>
          {denyErrors[r.id] && <div className="error-text">{denyErrors[r.id]}</div>}
        </div>
      ))}
    </div>
  );
}

export function AdminUsersPage() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [prefill, setPrefill] = useState<CreateUserPrefill | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<AdminUser[]>("/users"),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<AdminUser, "role" | "active">> }) =>
      api.patch(`/users/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleteErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onError: (err, id) => setDeleteErrors((prev) => ({ ...prev, [id]: extractErrorMessage(err) })),
  });

  if (isLoading || !users) {
    return <div className="muted">{t("adminUsers.loadingUsers")}</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.users")}</h1>
        <CreateUserForm prefill={prefill} onDone={() => setPrefill(null)} />
      </div>
      <PendingAccessRequests onApprove={setPrefill} />
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.email")}</th>
              <th>{t("common.role")}</th>
              <th>{t("common.status")}</th>
              <th>{t("adminUsers.joined")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={(e) => updateUser.mutate({ id: u.id, data: { role: e.target.value as AdminUser["role"] } })}
                      style={{ width: "auto" }}
                    >
                      <option value="MEMBER">{t("common.roleMember")}</option>
                      <option value="PROJECT_LEAD">{t("common.roleProjectLead")}</option>
                      <option value="ADMIN">{t("common.roleAdmin")}</option>
                    </select>
                  </td>
                  <td>{u.active ? t("common.active") : t("adminUsers.deactivated")}</td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td className="gap-8">
                    <button
                      className="btn btn-sm"
                      disabled={u.id === me?.id}
                      onClick={() => updateUser.mutate({ id: u.id, data: { active: !u.active } })}
                    >
                      {u.active ? t("common.deactivate") : t("common.reactivate")}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={u.id === me?.id}
                      onClick={() => {
                        if (confirm(t("adminUsers.confirmDeleteUser", { name: u.name }))) {
                          deleteUser.mutate(u.id);
                        }
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
                {deleteErrors[u.id] && (
                  <tr>
                    <td colSpan={6}>
                      <div className="error-text">{deleteErrors[u.id]}</div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
