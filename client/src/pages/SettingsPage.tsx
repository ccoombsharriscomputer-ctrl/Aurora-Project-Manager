import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { AccentColor, CurrentUser, Locale, ThemeMode } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

const ACCENT_COLORS: AccentColor[] = ["BLUE", "GREEN", "PURPLE", "ORANGE", "RED", "TEAL"];
const ACCENT_SWATCH_COLOR: Record<AccentColor, string> = {
  BLUE: "#3457d5",
  GREEN: "#1f9d55",
  PURPLE: "#7c3aed",
  ORANGE: "#d97706",
  RED: "#d64545",
  TEAL: "#0d9488",
};

function ChangePasswordCard() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changePassword = useMutation({
    mutationFn: () => api.patch("/auth/password", { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(t("settings.passwordsDoNotMatch"));
      return;
    }
    changePassword.mutate();
  }

  return (
    <form className="card" style={{ maxWidth: 480 }} onSubmit={handleSubmit}>
      <div className="section-title">{t("settings.changePassword")}</div>
      <div className="field">
        <label>{t("settings.currentPassword")}</label>
        <input
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label>{t("settings.newPassword")}</label>
        <input
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label>{t("settings.confirmNewPassword")}</label>
        <input
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={changePassword.isPending}>
          {t("common.save")}
        </button>
        {saved && <span className="muted">{t("settings.saved")}</span>}
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const [theme, setTheme] = useState<ThemeMode>(user!.theme);
  const [accentColor, setAccentColor] = useState<AccentColor>(user!.accentColor);
  const [locale, setLocale] = useState<Locale>(user!.locale);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.patch<CurrentUser>("/auth/me", { theme, accentColor, locale }),
    onSuccess: (updated) => {
      updateUser(updated);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  return (
    <div>
      <div className="page-header">
        <h1>{t("settings.title")}</h1>
      </div>

      <div className="card" style={{ maxWidth: 480, marginBottom: 20 }}>
        <div className="section-title">{t("settings.theme")}</div>
        <div className="gap-8" style={{ marginBottom: 20 }}>
          {(["SYSTEM", "LIGHT", "DARK"] as ThemeMode[]).map((mode) => (
            <label key={mode} className="gap-8" style={{ margin: 0, cursor: "pointer" }}>
              <input type="radio" name="theme" checked={theme === mode} onChange={() => setTheme(mode)} />
              <span>{t(`settings.theme${mode.charAt(0)}${mode.slice(1).toLowerCase()}`)}</span>
            </label>
          ))}
        </div>

        <div className="section-title">{t("settings.accentColor")}</div>
        <div className="gap-8" style={{ marginBottom: 20 }}>
          {ACCENT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setAccentColor(color)}
              title={t(`settings.accent${color.charAt(0)}${color.slice(1).toLowerCase()}`)}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: accentColor === color ? "3px solid var(--text)" : "1px solid var(--border)",
                background: ACCENT_SWATCH_COLOR[color],
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>

        <div className="field">
          <label>{t("settings.language")}</label>
          {/* Language names are always shown in their own language, regardless of the
              currently active UI language, so a user can find their language even if
              the app is currently displaying one they don't read. */}
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            <option value="EN">English</option>
            <option value="ES">Español</option>
            <option value="FR_CA">Français (Canada)</option>
          </select>
        </div>

        {error && <div className="error-text">{error}</div>}
        <div className="gap-8" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {t("common.save")}
          </button>
          {saved && <span className="muted">{t("settings.saved")}</span>}
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  );
}
