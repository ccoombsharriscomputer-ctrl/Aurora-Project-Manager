import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// The in-app helper: a round button bottom-right that opens a small chat. It only reads data
// (the server gives Claude read-only lookups), so it's open to every role. It's hidden until the
// server has an API key, except for admins, who see it with a setup message so they know it exists.
export function AssistantPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ["assistant-status"],
    queryFn: () => api.get<{ enabled: boolean }>("/assistant/status"),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, open]);

  if (!status || (!status.enabled && user?.role !== "ADMIN")) return null;

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setError(null);
    setPending(true);
    try {
      // The server is stateless, so each question carries the recent conversation with it.
      const { reply } = await api.post<{ reply: string }>("/assistant/chat", { messages: next.slice(-20) });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  if (!open) {
    return (
      <button type="button" className="assistant-fab" onClick={() => setOpen(true)} title={t("assistant.open")}>
        <span aria-hidden="true">✦</span>
        <span>{t("assistant.title")}</span>
      </button>
    );
  }

  const suggestions = [t("assistant.suggestOverdue"), t("assistant.suggestWeek"), t("assistant.suggestBehind")];

  return (
    <div className="assistant-panel" role="dialog" aria-label={t("assistant.title")}>
      <div className="assistant-head">
        <span>✦ {t("assistant.title")}</span>
        <div className="gap-8">
          {messages.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
            >
              {t("assistant.clear")}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} aria-label={t("assistant.close")}>
            ✕
          </button>
        </div>
      </div>

      <div className="assistant-messages">
        {messages.length === 0 && (
          <div className="assistant-intro">
            <p>{t("assistant.intro")}</p>
            {suggestions.map((s) => (
              <button key={s} type="button" className="assistant-suggestion" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`assistant-bubble assistant-bubble-${m.role}`}>
            {m.content}
          </div>
        ))}
        {pending && <div className="assistant-bubble assistant-bubble-assistant muted">{t("assistant.thinking")}</div>}
        {error && <div className="error-text">{error}</div>}
        <div ref={endRef} />
      </div>

      <div className="assistant-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("assistant.placeholder")}
          rows={2}
          maxLength={4000}
        />
        <button type="button" className="btn btn-primary" onClick={() => send(input)} disabled={pending || !input.trim()}>
          {t("assistant.send")}
        </button>
      </div>
    </div>
  );
}
