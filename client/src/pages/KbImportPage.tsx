import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { extractErrorMessage } from "../context/AuthContext";

// Kept here rather than in api/types.ts: only this page uses them.
interface KbArticle {
  ticketNumber: string;
  title: string;
  product: string | null;
  url: string;
  verdict: "correction" | "other" | null;
  reason: string | null;
  decision: "undecided" | "wanted" | "skipped";
  decidedByName: string | null;
  playbookId: string | null;
  draftNote: string | null;
}

interface JobState<T> {
  status: "pending" | "done";
  startedAt: string;
  result: T | null;
}

type SortResult = { found: number; sorted: number; stillToSort: number };
type DraftResult = { made: number; couldNot: number; stillToDraft: number };

type Filter = "correction" | "other" | "unsorted" | "all";
type JobKind = "sort" | "drafts";

// Sorting and drafting both ask Claude about several articles, which outlasts one web request,
// so the server runs them in the background and this checks back every few seconds.
const POLL_MS = 4000;
const GIVE_UP_MS = 10 * 60 * 1000;

export function KbImportPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("correction");
  const [running, setRunning] = useState<JobKind | null>(null);
  const [lastSort, setLastSort] = useState<SortResult | null>(null);
  const [lastDrafts, setLastDrafts] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["kb-articles"],
    queryFn: () =>
      api.get<{ articles: KbArticle[]; sort: JobState<SortResult> | null; drafts: JobState<DraftResult> | null }>(
        "/fix-playbooks/kb-articles"
      ),
  });

  useEffect(() => () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }, []);

  function poll(kind: JobKind, startedAt: number) {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const state = await api.get<JobState<SortResult | DraftResult> | null>(`/fix-playbooks/kb-articles/${kind}`);
        if (state?.status === "pending") {
          if (Date.now() - startedAt > GIVE_UP_MS) {
            setRunning(null);
            setError(t("kbImport.tooLong"));
          } else {
            poll(kind, startedAt);
          }
          return;
        }
        setRunning(null);
        if (kind === "sort") setLastSort((state?.result as SortResult) ?? null);
        else setLastDrafts((state?.result as DraftResult) ?? null);
        queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
        if (kind === "drafts") queryClient.invalidateQueries({ queryKey: ["fix-playbooks"] });
      } catch (err) {
        setRunning(null);
        setError(extractErrorMessage(err));
        queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
      }
    }, POLL_MS);
  }

  // Someone may have started a run before this page opened: keep watching it.
  const runningAtLoad: JobKind | null =
    data?.sort?.status === "pending" ? "sort" : data?.drafts?.status === "pending" ? "drafts" : null;
  useEffect(() => {
    if (runningAtLoad && !running) {
      setRunning(runningAtLoad);
      poll(runningAtLoad, Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningAtLoad]);

  async function start(kind: JobKind) {
    setError(null);
    if (kind === "sort") setLastSort(null);
    else setLastDrafts(null);
    try {
      setRunning(kind);
      await api.post(`/fix-playbooks/kb-articles/${kind}`);
      poll(kind, Date.now());
    } catch (err) {
      setRunning(null);
      setError(extractErrorMessage(err));
    }
  }

  const decide = useMutation({
    mutationFn: ({ ticketNumber, decision }: { ticketNumber: string; decision: KbArticle["decision"] }) =>
      api.patch<KbArticle>(`/fix-playbooks/kb-articles/${encodeURIComponent(ticketNumber)}`, { decision }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kb-articles"] }),
    onError: (err) => setError(extractErrorMessage(err)),
  });

  if (isLoading || !data) {
    return <div className="muted">{t("kbImport.loading")}</div>;
  }

  const articles = data.articles;
  const waitingForDraft = articles.filter((a) => a.decision === "wanted" && !a.playbookId).length;
  const count = (f: Filter) =>
    f === "all" ? articles.length : articles.filter((a) => (f === "unsorted" ? a.verdict === null : a.verdict === f)).length;
  const shown = articles.filter((a) =>
    filter === "all" ? true : filter === "unsorted" ? a.verdict === null : a.verdict === filter
  );
  const filters: Filter[] = ["correction", "other", "unsorted", "all"];

  return (
    <div>
      <div className="page-header page-header-plain">
        <h1>{t("kbImport.title")}</h1>
        <Link className="btn" to="/fix-playbooks">
          {t("kbImport.backToPlaybooks")}
        </Link>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        {t("kbImport.intro")}
      </p>
      <div className="gap-8" style={{ marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => start("sort")} disabled={!!running}>
          {running === "sort" ? t("kbImport.sorting") : t("kbImport.sortButton")}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>{t("kbImport.sortHelp")}</span>
      </div>
      <div className="gap-8" style={{ marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => start("drafts")} disabled={!!running || waitingForDraft === 0}>
          {running === "drafts" ? t("kbImport.drafting") : t("kbImport.draftButton", { count: waitingForDraft })}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>{t("kbImport.draftHelp")}</span>
      </div>
      {lastSort && (
        <div className="card" style={{ marginBottom: 12 }}>
          {t("kbImport.lastRun", { found: lastSort.found, sorted: lastSort.sorted })}{" "}
          {lastSort.stillToSort > 0 ? t("kbImport.stillToSort", { count: lastSort.stillToSort }) : t("kbImport.allSorted")}
        </div>
      )}
      {lastDrafts && (
        <div className="card" style={{ marginBottom: 12 }}>
          {t("kbImport.draftsMade", { made: lastDrafts.made })}{" "}
          {lastDrafts.couldNot > 0 && t("kbImport.draftsCouldNot", { count: lastDrafts.couldNot })}{" "}
          {lastDrafts.stillToDraft > 0 && t("kbImport.stillToDraft", { count: lastDrafts.stillToDraft })}{" "}
          {lastDrafts.made > 0 && <Link to="/fix-playbooks">{t("kbImport.checkDrafts")}</Link>}
        </div>
      )}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="gap-8" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button key={f} className={`btn btn-sm${filter === f ? " btn-primary" : ""}`} onClick={() => setFilter(f)}>
            {t(`kbImport.filter_${f}`)} ({count(f)})
          </button>
        ))}
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{t("kbImport.article")}</th>
              <th>{t("kbImport.product")}</th>
              <th>{t("kbImport.aiSort")}</th>
              <th>{t("kbImport.yourPick")}</th>
              <th>{t("kbImport.playbook")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.ticketNumber}>
                <td>
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    {a.title}
                  </a>
                  <div className="muted" style={{ fontSize: 12 }}>#{a.ticketNumber}</div>
                </td>
                <td>{a.product ?? "—"}</td>
                <td>
                  <strong>
                    {a.verdict === "correction"
                      ? t("kbImport.correction")
                      : a.verdict === "other"
                        ? t("kbImport.other")
                        : t("kbImport.notSorted")}
                  </strong>
                  {a.reason && <div className="muted" style={{ fontSize: 12 }}>{a.reason}</div>}
                </td>
                <td>
                  <select
                    value={a.decision}
                    disabled={decide.isPending}
                    onChange={(e) =>
                      decide.mutate({ ticketNumber: a.ticketNumber, decision: e.target.value as KbArticle["decision"] })
                    }
                    style={{ width: "auto" }}
                  >
                    <option value="undecided">{t("kbImport.undecided")}</option>
                    <option value="wanted">{t("kbImport.wanted")}</option>
                    <option value="skipped">{t("kbImport.skipped")}</option>
                  </select>
                  {a.decidedByName && a.decision !== "undecided" && (
                    <div className="muted" style={{ fontSize: 12 }}>{a.decidedByName}</div>
                  )}
                </td>
                <td>
                  {a.playbookId ? (
                    <Link to="/fix-playbooks">{t("kbImport.draftMade")}</Link>
                  ) : a.decision === "wanted" ? (
                    <span className="muted">{t("kbImport.waitingForDraft")}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  {a.draftNote && <div className="muted" style={{ fontSize: 12 }}>{a.draftNote}</div>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {articles.length === 0 ? t("kbImport.noneYet") : t("kbImport.noneHere")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
