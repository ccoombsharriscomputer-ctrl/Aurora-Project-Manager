import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { AccentColor, CurrentUser, Locale, ThemeMode } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

const ACCENT_COLORS: AccentColor[] = ["BLUE", "GREEN", "PURPLE", "ORANGE", "RED", "TEAL", "INDIGO", "PINK", "CYAN", "GOLD", "LIME", "GRAPHITE"];
const ACCENT_SWATCH_COLOR: Record<AccentColor, string> = {
  BLUE: "#3457d5",
  GREEN: "#1f9d55",
  PURPLE: "#7c3aed",
  ORANGE: "#d97706",
  RED: "#d64545",
  TEAL: "#0d9488",
  INDIGO: "#4f46e5",
  PINK: "#db2777",
  CYAN: "#0891b2",
  GOLD: "#b7791f",
  LIME: "#4d7c0f",
  GRAPHITE: "#475569",
};

// Only these follow the accent color; the named themes bring their own colors.
const ACCENT_THEMES: ThemeMode[] = ["SYSTEM", "LIGHT", "DARK"];

// Each theme's little preview in the picker: page color, sidebar strip, banner, and four panel dots.
// (The real colors live in index.css; these only have to look like them.)
const THEME_PREVIEWS: { mode: ThemeMode; page: string; side: string; banner: string; dots: string[] }[] = [
  { mode: "SYSTEM", page: "linear-gradient(135deg, #f1f3fa 50%, #12151c 50%)", side: "#3457d5", banner: "#7c3aed", dots: ["#3457d5", "#10b981", "#f59e0b", "#7c3aed"] },
  { mode: "LIGHT", page: "#f1f3fa", side: "#2b3a8f", banner: "linear-gradient(90deg, #3457d5, #7c3aed)", dots: ["#4f46e5", "#10b981", "#f59e0b", "#7c3aed"] },
  { mode: "DARK", page: "#12151c", side: "#1d2554", banner: "linear-gradient(90deg, #3457d5, #7c3aed)", dots: ["#4f46e5", "#10b981", "#f59e0b", "#7c3aed"] },
  { mode: "MIDNIGHT", page: "linear-gradient(135deg, #0f1230, #241553)", side: "#1c1f5c", banner: "linear-gradient(90deg, #6366f1, #a855f7)", dots: ["#6366f1", "#0891b2", "#db2777", "#d97706"] },
  { mode: "AURORA", page: "linear-gradient(135deg, #06151f, #1a0b3b)", side: "#0d3b3f", banner: "linear-gradient(90deg, #10b981, #8b5cf6)", dots: ["#059669", "#0891b2", "#7c3aed", "#db2777"] },
  { mode: "SUNSET", page: "#fff4ec", side: "#d44a1c", banner: "linear-gradient(90deg, #f97316, #db2777)", dots: ["#ea580c", "#e11d48", "#db2777", "#d97706"] },
  { mode: "OCEAN", page: "#eaf7fb", side: "#0e7490", banner: "linear-gradient(90deg, #0891b2, #2563eb)", dots: ["#0891b2", "#2563eb", "#0d9488", "#0284c7"] },
  { mode: "FOREST", page: "#eef6ef", side: "#14532d", banner: "linear-gradient(90deg, #15803d, #0d9488)", dots: ["#15803d", "#4d7c0f", "#0f766e", "#a16207"] },
  { mode: "PASTEL", page: "#faf7ff", side: "#8b6bea", banner: "linear-gradient(90deg, #a78bfa, #f9a8d4)", dots: ["#c4b5fd", "#86efac", "#fcd34d", "#f9a8d4"] },
  { mode: "SLATE", page: "#f1f5f9", side: "#334155", banner: "linear-gradient(90deg, #475569, #64748b)", dots: ["#475569", "#475569", "#475569", "#475569"] },
  { mode: "CONTRAST", page: "#000", side: "#000", banner: "#ffd400", dots: ["#ffd400", "#00e5ff", "#ffd400", "#00e5ff"] },
  { mode: "GOTHAM", page: "#0b0d10", side: "#1b1f27", banner: "linear-gradient(90deg, #1f2530, #ffd21f)", dots: ["#ffd21f", "#3b4658", "#6f84a0", "#e0a800"] },
  { mode: "METROPOLIS", page: "#eef4ff", side: "#0b3d91", banner: "linear-gradient(90deg, #0b3d91, #1d4ed8 70%, #dc2626)", dots: ["#1d4ed8", "#dc2626", "#facc15", "#0b3d91"] },
  { mode: "EMPIRE", page: "#08080a", side: "#16161b", banner: "linear-gradient(90deg, #1a1a20, #7f0d15)", dots: ["#c1121f", "#3a3a45", "#7a0c13", "#5a5a68"] },
  { mode: "TATOOINE", page: "#fbf3e4", side: "#6b4423", banner: "linear-gradient(90deg, #92400e, #f59e0b)", dots: ["#b45309", "#a16207", "#c2410c", "#78350f"] },
  { mode: "HOTH", page: "#f0f6fb", side: "#1e3a5f", banner: "linear-gradient(90deg, #0c4a6e, #7dd3fc)", dots: ["#0369a1", "#475569", "#0e7490", "#1e3a5f"] },
  { mode: "GALAXY", page: "linear-gradient(135deg, #05060f, #0d1230)", side: "#0b1030", banner: "linear-gradient(90deg, #070a1f, #1e40af, #0ea5e9)", dots: ["#2563eb", "#16a34a", "#dc2626", "#7e22ce"] },
];

// "MIDNIGHT" -> "settings.themeMidnight", matching the translation keys.
function themeLabelKey(mode: ThemeMode) {
  return `settings.theme${mode.charAt(0)}${mode.slice(1).toLowerCase()}`;
}

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

      <div className="card" style={{ maxWidth: 560, marginBottom: 20 }}>
        <div className="section-title">{t("settings.theme")}</div>
        <div className="theme-grid">
          {THEME_PREVIEWS.map((p) => (
            <button
              key={p.mode}
              type="button"
              className={`theme-tile${theme === p.mode ? " selected" : ""}`}
              onClick={() => setTheme(p.mode)}
              aria-pressed={theme === p.mode}
            >
              <span className="theme-preview" style={{ background: p.page }}>
                <span className="theme-preview-side" style={{ background: p.side }} />
                <span className="theme-preview-main">
                  <span className="theme-preview-banner" style={{ background: p.banner }} />
                  <span className="theme-preview-dots">
                    {p.dots.map((c, i) => (
                      <span key={i} style={{ background: c }} />
                    ))}
                  </span>
                </span>
              </span>
              <span className="theme-tile-label">{t(themeLabelKey(p.mode))}</span>
            </button>
          ))}
        </div>

        <div className="section-title">{t("settings.accentColor")}</div>
        {!ACCENT_THEMES.includes(theme) && <p className="muted">{t("settings.themeHasOwnColors")}</p>}
        <div className="gap-8" style={{ marginBottom: 20, flexWrap: "wrap", opacity: ACCENT_THEMES.includes(theme) ? 1 : 0.4 }}>
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
