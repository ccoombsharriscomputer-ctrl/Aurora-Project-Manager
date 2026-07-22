import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import i18n from "../i18n";

export function RequestAccessPage() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/access-requests", { name, email, message: message || undefined });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : i18n.t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h1>{t("requestAccess.receivedTitle")}</h1>
          <div className="subtitle">{t("requestAccess.receivedSubtitle")}</div>
          <p style={{ marginTop: 16, fontSize: 13 }}>
            <Link to="/login">{t("requestAccess.backToLogIn")}</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>{t("requestAccess.title")}</h1>
        <div className="subtitle">{t("requestAccess.subtitle")}</div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">{t("common.name")}</label>
            <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">{t("common.email")}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="message">{t("requestAccess.messageOptional")}</label>
            <textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? t("requestAccess.sending") : t("requestAccess.requestAccess")}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13 }}>
          {t("requestAccess.alreadyHaveAccount")} <Link to="/login">{t("login.logIn")}</Link>
        </p>
      </div>
    </div>
  );
}
