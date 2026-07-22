import { useEffect } from "react";
import type { CurrentUser } from "../api/types";

export function useApplyTheme(user: CurrentUser | null) {
  useEffect(() => {
    const root = document.documentElement;

    if (!user || user.theme === "SYSTEM") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = user.theme.toLowerCase();
    }

    if (!user) {
      delete root.dataset.accent;
    } else {
      root.dataset.accent = user.accentColor.toLowerCase();
    }
  }, [user?.theme, user?.accentColor]);
}
