import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import i18n from "../i18n";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h1>{t("resetPassword.invalidLinkTitle")}</h1>
          <div className="subtitle">{t("resetPassword.invalidLinkSubtitle")}</div>
          <p style={{ marginTop: 16, fontSize: 13 }}>
            <Link to="/forgot-password">{t("resetPassword.requestNewLink")}</Link>
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("settings.passwordsDoNotMatch"));
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/password-reset/confirm", { token, newPassword });
      navigate("/login", { state: { passwordResetDone: true } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : i18n.t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>{t("resetPassword.title")}</h1>
        <div className="subtitle">{t("resetPassword.subtitle")}</div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="newPassword">{t("settings.newPassword")}</label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">{t("settings.confirmNewPassword")}</label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? t("resetPassword.resetting") : t("resetPassword.resetPassword")}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13 }}>
          <Link to="/login">{t("requestAccess.backToLogIn")}</Link>
        </p>
      </div>
    </div>
  );
}
