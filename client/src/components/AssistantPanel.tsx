import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Just the parts of the browser's speech-to-text we use (it isn't in TypeScript's built-in types).
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function getRecognitionClass(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// The speech language follows the app's language setting.
function speechLang(appLang: string): string {
  if (appLang.startsWith("es")) return "es-ES";
  if (appLang.startsWith("fr")) return "fr-CA";
  return "en-US";
}

const SPEAK_KEY = "aurora-jarvis-speak";
const VOICE_KEY = "aurora-jarvis-voice";

function readVoicePreference(): string {
  try {
    return localStorage.getItem(VOICE_KEY) ?? "";
  } catch {
    return "";
  }
}

// The voices on offer are whatever this browser and computer have installed (Edge, for one, ships
// very natural ones). Show the ones in the app's language first; fall back to all if there are none.
function voicesFor(all: SpeechSynthesisVoice[], appLang: string): SpeechSynthesisVoice[] {
  const base = speechLang(appLang).slice(0, 2);
  const matching = all.filter((v) => v.lang.toLowerCase().startsWith(base));
  return (matching.length > 0 ? matching : all).slice().sort((a, b) => a.name.localeCompare(b.name));
}

function readSpeakPreference(): boolean {
  try {
    return localStorage.getItem(SPEAK_KEY) === "1";
  } catch {
    return false;
  }
}

// The in-app helper: a round button bottom-right that opens a small chat. It only reads data
// (the server gives Claude read-only lookups), so it's open to every role. It's hidden until the
// server has an API key, except for admins, who see it with a setup message so they know it exists.
// You can talk to it (the mic button, using the browser's own speech recognition) and have it read
// answers aloud (the speaker button) — both are browser features, so they only show up where the
// browser supports them, and neither needs anything on the server.
export function AssistantPanel() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(readSpeakPreference);
  const [voiceName, setVoiceName] = useState(readVoicePreference);
  const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const spokenTranscriptRef = useRef("");
  const sendRef = useRef<(text: string) => void>(() => {});

  const { data: status } = useQuery({
    queryKey: ["assistant-status"],
    queryFn: () => api.get<{ enabled: boolean }>("/assistant/status"),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, open]);

  // Browsers load their voice list a moment after the page does, and announce it with this event.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => setAllVoices(synth.getVoices());
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, []);

  // Closing the chat (or leaving the page) stops listening and talking.
  useEffect(() => {
    if (open) return;
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
  }, [open]);
  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    },
    []
  );

  if (!status || (!status.enabled && user?.role !== "ADMIN")) return null;

  const canListen = getRecognitionClass() !== null;
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const voices = voicesFor(allVoices, i18n.language);

  function speak(text: string, name: string = voiceName) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    // Bullet dashes would be read out as "dash"; drop them.
    const utterance = new SpeechSynthesisUtterance(text.replace(/^\s*-\s+/gm, ""));
    const voice = name ? allVoices.find((v) => v.name === name) : undefined;
    if (voice) {
      try {
        utterance.voice = voice;
      } catch {
        // A voice that has gone away since the list loaded; the language below still applies.
      }
      utterance.lang = voice.lang;
    } else {
      utterance.lang = speechLang(i18n.language);
    }
    window.speechSynthesis.speak(utterance);
  }

  function chooseVoice(name: string) {
    setVoiceName(name);
    try {
      localStorage.setItem(VOICE_KEY, name);
    } catch {
      // Choice just won't be remembered.
    }
    speak(t("assistant.voiceSample"), name);
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    window.speechSynthesis?.cancel();
    const next: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setError(null);
    setPending(true);
    try {
      // The server is stateless, so each question carries the recent conversation with it.
      const { reply } = await api.post<{ reply: string }>("/assistant/chat", { messages: next.slice(-20) });
      setMessages([...next, { role: "assistant", content: reply }]);
      if (speakReplies) speak(reply);
    } catch (err) {
      // Take the unanswered question back out of the chat and into the box, so retrying (or asking
      // something else) doesn't leave two questions in a row for Jarvis to answer at once.
      setMessages(messages);
      setInput(question);
      setError(extractErrorMessage(err));
    } finally {
      setPending(false);
    }
  }
  sendRef.current = send;

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = getRecognitionClass();
    if (!Recognition || pending) return;
    window.speechSynthesis?.cancel();
    setError(null);
    spokenTranscriptRef.current = "";
    const recognition = new Recognition();
    recognition.lang = speechLang(i18n.language);
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      spokenTranscriptRef.current = transcript;
      setInput(transcript);
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError(t("assistant.micBlocked"));
      else if (e.error !== "aborted" && e.error !== "no-speech") setError(t("assistant.micError"));
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      // Stopped talking: send what was heard, like pressing Send.
      const heard = spokenTranscriptRef.current.trim();
      spokenTranscriptRef.current = "";
      if (heard) sendRef.current(heard);
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }

  function toggleSpeakReplies() {
    const next = !speakReplies;
    setSpeakReplies(next);
    if (!next) window.speechSynthesis?.cancel();
    try {
      localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
    } catch {
      // Preference just won't be remembered.
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
          {canSpeak && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={toggleSpeakReplies}
              aria-pressed={speakReplies}
              title={speakReplies ? t("assistant.speakOff") : t("assistant.speakOn")}
              aria-label={speakReplies ? t("assistant.speakOff") : t("assistant.speakOn")}
            >
              {speakReplies ? "🔊" : "🔇"}
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                window.speechSynthesis?.cancel();
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

      {speakReplies && voices.length > 0 && (
        <div className="assistant-voicebar">
          <label htmlFor="assistant-voice">{t("assistant.voice")}</label>
          <select id="assistant-voice" value={voiceName} onChange={(e) => chooseVoice(e.target.value)}>
            <option value="">{t("assistant.voiceDefault")}</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
          placeholder={listening ? t("assistant.listening") : t("assistant.placeholder")}
          rows={2}
          maxLength={4000}
        />
        {canListen && (
          <button
            type="button"
            className={`assistant-mic${listening ? " listening" : ""}`}
            onClick={toggleListening}
            disabled={pending}
            aria-pressed={listening}
            title={listening ? t("assistant.stopTalking") : t("assistant.talk")}
            aria-label={listening ? t("assistant.stopTalking") : t("assistant.talk")}
          >
            🎙
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => send(input)} disabled={pending || !input.trim()}>
          {t("assistant.send")}
        </button>
      </div>
    </div>
  );
}
