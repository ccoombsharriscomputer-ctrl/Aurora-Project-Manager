import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, extractErrorMessage } from "../context/AuthContext";

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set by ResetPasswordPage's navigate() after a successful reset — a one-time confirmation
  // that the new password took effect, not persisted anywhere.
  const passwordResetDone = Boolean((location.state as { passwordResetDone?: boolean } | null)?.passwordResetDone);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <img src="/logo.png" alt="" className="auth-logo" />
        <h1>{t("login.title")}</h1>
        <div className="subtitle">{t("login.subtitle")}</div>
        {passwordResetDone && <div className="success-text">{t("resetPassword.done")}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">{t("common.email")}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <div className="flex-between">
              <label htmlFor="password">{t("common.password")}</label>
              <Link to="/forgot-password" style={{ fontSize: 13 }}>
                {t("login.forgotPassword")}
              </Link>
            </div>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? t("login.loggingIn") : t("login.logIn")}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13 }}>
          {t("login.needAccess")} <Link to="/request-access">{t("login.requestAnAccount")}</Link>
        </p>
      </div>
    </div>
  );
}
