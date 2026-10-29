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
}

interface SortState {
  status: "pending" | "done";
  startedAt: string;
  result: { found: number; sorted: number; stillToSort: number } | null;
}

type Filter = "correction" | "other" | "unsorted" | "all";

// A run reads up to 40 articles and asks Claude about them, which outlasts one web request, so
// the server sorts in the background and this checks back every few seconds.
const SORT_POLL_MS = 4000;
const SORT_GIVE_UP_MS = 10 * 60 * 1000;

export function KbImportPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("correction");
  const [sorting, setSorting] = useState(false);
  const [lastRun, setLastRun] = useState<SortState["result"]>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["kb-articles"],
    queryFn: () => api.get<{ articles: KbArticle[]; sort: SortState | null }>("/fix-playbooks/kb-articles"),
  });

  useEffect(() => () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }, []);

  function pollSort(startedAt: number) {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const state = await api.get<SortState | null>("/fix-playbooks/kb-articles/sort");
        if (state?.status === "pending") {
          if (Date.now() - startedAt > SORT_GIVE_UP_MS) {
            setSorting(false);
            setError(t("kbImport.sortTooLong"));
          } else {
            pollSort(startedAt);
          }
          return;
        }
        setSorting(false);
        setLastRun(state?.result ?? null);
        queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
      } catch (err) {
        setSorting(false);
        setError(extractErrorMessage(err));
        queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
      }
    }, SORT_POLL_MS);
  }

  // Someone may have started a run before this page opened: keep watching it.
  const runningAtLoad = data?.sort?.status === "pending";
  useEffect(() => {
    if (runningAtLoad && !sorting) {
      setSorting(true);
      pollSort(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningAtLoad]);

  async function startSort() {
    setError(null);
    setLastRun(null);
    try {
      setSorting(true);
      await api.post("/fix-playbooks/kb-articles/sort");
      pollSort(Date.now());
    } catch (err) {
      setSorting(false);
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
      <div className="gap-8" style={{ marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={startSort} disabled={sorting}>
          {sorting ? t("kbImport.sorting") : t("kbImport.sortButton")}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>{t("kbImport.sortHelp")}</span>
      </div>
      {lastRun && (
        <div className="card" style={{ marginBottom: 12 }}>
          {t("kbImport.lastRun", { found: lastRun.found, sorted: lastRun.sorted })}{" "}
          {lastRun.stillToSort > 0 ? t("kbImport.stillToSort", { count: lastRun.stillToSort }) : t("kbImport.allSorted")}
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
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
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
