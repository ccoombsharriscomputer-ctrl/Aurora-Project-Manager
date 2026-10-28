import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import { extractErrorMessage } from "../context/AuthContext";
import { formatDate } from "../utils/format";

// Kept here rather than in api/types.ts: only this admin page uses them.
interface FixPlaybook {
  id: string;
  title: string;
  matchPhrases: string[];
  products: string[];
  steps: string;
  active: boolean;
  sourceTickets: string[];
  updatedByName: string | null;
  updatedAt: string;
}

interface PlaybookDraft {
  steps: string[];
  cautions: string;
  basedOn: { ticketNumber: string; why: string }[];
  ticketsRead: number;
}

const splitList = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

// A draft reads up to 8 tickets and asks Claude, which outlasts one web request, so the server
// runs it in the background and this checks back every few seconds.
const DRAFT_POLL_MS = 4000;
const DRAFT_GIVE_UP_MS = 6 * 60 * 1000;

function PlaybookForm({ playbook, onDone }: { playbook: FixPlaybook | null; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(playbook?.id ?? null);
  const [title, setTitle] = useState(playbook?.title ?? "");
  const [phrases, setPhrases] = useState(playbook?.matchPhrases.join(", ") ?? "");
  const [products, setProducts] = useState(playbook?.products.join(", ") ?? "");
  const [steps, setSteps] = useState(playbook?.steps ?? "");
  const [active, setActive] = useState(playbook?.active ?? false);
  const [sourceTickets, setSourceTickets] = useState<string[]>(playbook?.sourceTickets ?? []);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }, []);

  const body = (overrides: Partial<FixPlaybook> = {}) => ({
    title,
    matchPhrases: splitList(phrases),
    products: splitList(products),
    steps,
    active,
    sourceTickets,
    ...overrides,
  });

  const save = useMutation({
    mutationFn: (data: ReturnType<typeof body>) =>
      savedId ? api.patch<FixPlaybook>(`/fix-playbooks/${savedId}`, data) : api.post<FixPlaybook>("/fix-playbooks", data),
    onSuccess: (saved) => {
      setSavedId(saved.id);
      queryClient.invalidateQueries({ queryKey: ["fix-playbooks"] });
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/fix-playbooks/${savedId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fix-playbooks"] });
      onDone();
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  function pollDraft(id: string, startedAt: number) {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const result = await api.get<PlaybookDraft | { pending: true }>(`/fix-playbooks/${id}/ai-draft`);
        if ("pending" in result) {
          if (Date.now() - startedAt > DRAFT_GIVE_UP_MS) {
            setDrafting(false);
            setError(t("fixPlaybooks.draftTooLong"));
          } else {
            pollDraft(id, startedAt);
          }
          return;
        }
        setDrafting(false);
        setDraft(result);
        if (result.steps.length && (!steps.trim() || confirm(t("fixPlaybooks.confirmReplaceSteps")))) {
          setSteps(result.steps.join("\n"));
          setSourceTickets(result.basedOn.map((b) => b.ticketNumber.replace(/^#/, "")));
        }
      } catch (err) {
        setDrafting(false);
        setError(err instanceof ApiError ? err.message : extractErrorMessage(err));
      }
    }, DRAFT_POLL_MS);
  }

  // The draft uses the saved match words and products, so save first (without switching on).
  async function startDraft() {
    setError(null);
    setDraft(null);
    try {
      const saved = await save.mutateAsync(body({ active: savedId ? (playbook?.active ?? false) : false }));
      setDrafting(true);
      await api.post(`/fix-playbooks/${saved.id}/ai-draft`);
      pollDraft(saved.id, Date.now());
    } catch (err) {
      setDrafting(false);
      setError(extractErrorMessage(err));
    }
  }

  return (
    <form
      className="card"
      style={{ margin: "8px 0 16px" }}
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        try {
          await save.mutateAsync(body());
          onDone();
        } catch {
          // shown by onError
        }
      }}
    >
      <div className="field">
        <label>{t("fixPlaybooks.titleLabel")}</label>
        <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("fixPlaybooks.titlePlaceholder")} />
      </div>
      <div className="field">
        <label>{t("fixPlaybooks.matchWords")}</label>
        <input type="text" value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder={t("fixPlaybooks.matchWordsPlaceholder")} />
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("fixPlaybooks.matchWordsHelp")}</div>
      </div>
      <div className="field">
        <label>{t("fixPlaybooks.products")}</label>
        <input type="text" value={products} onChange={(e) => setProducts(e.target.value)} placeholder={t("fixPlaybooks.productsPlaceholder")} />
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("fixPlaybooks.productsHelp")}</div>
      </div>
      <div className="field">
        <label>{t("fixPlaybooks.steps")}</label>
        <textarea rows={10} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={t("fixPlaybooks.stepsPlaceholder")} />
        <div className="gap-8" style={{ marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-sm" type="button" onClick={startDraft} disabled={drafting || save.isPending || !title.trim()}>
            {drafting ? t("fixPlaybooks.drafting") : t("fixPlaybooks.draftWithAi")}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>{t("fixPlaybooks.draftHelp")}</span>
        </div>
      </div>
      {draft && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div>
            <strong>{t("fixPlaybooks.draftReady", { count: draft.ticketsRead })}</strong>
          </div>
          {draft.cautions && (
            <p style={{ margin: "6px 0" }}>
              <strong>{t("fixPlaybooks.checkThis")}</strong> {draft.cautions}
            </p>
          )}
          {draft.basedOn.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {draft.basedOn.map((b) => (
                <li key={b.ticketNumber}>
                  #{b.ticketNumber.replace(/^#/, "")}: {b.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {sourceTickets.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          {t("fixPlaybooks.basedOnTickets", { tickets: sourceTickets.map((n) => `#${n}`).join(", ") })}
        </div>
      )}
      <label className="gap-8" style={{ cursor: "pointer", marginBottom: 12 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>{t("fixPlaybooks.activeLabel")}</span>
      </label>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={save.isPending || drafting}>
          {t("common.save")}
        </button>
        <button className="btn" type="button" onClick={onDone}>
          {t("common.cancel")}
        </button>
        {savedId && (
          <button
            className="btn btn-danger"
            type="button"
            style={{ marginLeft: "auto" }}
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(t("fixPlaybooks.confirmDelete", { title }))) remove.mutate();
            }}
          >
            {t("common.delete")}
          </button>
        )}
      </div>
    </form>
  );
}

export function FixPlaybooksPage() {
  const { t } = useTranslation();
  // null = closed, "new" = new playbook form, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const { data: playbooks, isLoading } = useQuery({
    queryKey: ["fix-playbooks"],
    queryFn: () => api.get<FixPlaybook[]>("/fix-playbooks"),
  });

  if (isLoading || !playbooks) {
    return <div className="muted">{t("fixPlaybooks.loading")}</div>;
  }

  return (
    <div>
      <div className="page-header page-header-plain">
        <h1>{t("layout.fixPlaybooks")}</h1>
        {editing !== "new" && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            {t("fixPlaybooks.newPlaybook")}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        {t("fixPlaybooks.intro")}
      </p>
      {editing === "new" && <PlaybookForm playbook={null} onDone={() => setEditing(null)} />}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{t("fixPlaybooks.titleLabel")}</th>
              <th>{t("fixPlaybooks.matchWords")}</th>
              <th>{t("fixPlaybooks.products")}</th>
              <th>{t("common.status")}</th>
              <th>{t("fixPlaybooks.lastChanged")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {playbooks.map((p) =>
              editing === p.id ? (
                <tr key={p.id}>
                  <td colSpan={6}>
                    <PlaybookForm playbook={p} onDone={() => setEditing(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td>{p.matchPhrases.join(", ") || "—"}</td>
                  <td>{p.products.join(", ") || t("fixPlaybooks.anyProduct")}</td>
                  <td>
                    {p.active
                      ? t("fixPlaybooks.on")
                      : p.steps.trim()
                        ? t("fixPlaybooks.offReadyToCheck")
                        : t("fixPlaybooks.offNoSteps")}
                  </td>
                  <td>
                    {formatDate(p.updatedAt)}
                    {p.updatedByName ? ` · ${p.updatedByName}` : ""}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setEditing(p.id)}>
                      {t("common.edit")}
                    </button>
                  </td>
                </tr>
              )
            )}
            {playbooks.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t("fixPlaybooks.none")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
