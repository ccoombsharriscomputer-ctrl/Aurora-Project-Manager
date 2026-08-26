import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import i18n from "../i18n";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/password-reset/request", { email });
      // Shown regardless of whether the email actually matched an account — the server
      // response is identical either way, so this page can't be used to check who has one.
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
          <h1>{t("forgotPassword.receivedTitle")}</h1>
          <div className="subtitle">{t("forgotPassword.receivedSubtitle")}</div>
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
        <h1>{t("forgotPassword.title")}</h1>
        <div className="subtitle">{t("forgotPassword.subtitle")}</div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">{t("common.email")}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? t("forgotPassword.sending") : t("forgotPassword.sendResetLink")}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13 }}>
          <Link to="/login">{t("requestAccess.backToLogIn")}</Link>
        </p>
      </div>
    </div>
  );
}
