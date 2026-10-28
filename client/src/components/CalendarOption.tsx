import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";

// "Also add to the Aurora Calendar" tick box shown with a task's assignee and due date. Hidden
// until the server says the calendar link is set up (unless the task is already on it).
export function CalendarOption({
  checked,
  onChange,
  ready,
  alreadyOn = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // True once the task has both an assignee and a due date, which the calendar needs.
  ready: boolean;
  alreadyOn?: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["calendar-status"],
    queryFn: () => api.get<{ enabled: boolean }>("/calendar/status"),
    staleTime: 10 * 60 * 1000,
  });
  if (!data?.enabled && !alreadyOn) return null;
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontWeight: "normal" }}>
      <input type="checkbox" checked={checked} disabled={!ready} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {t("calendarOption.label")}
        {!ready && <span className="muted"> — {t("calendarOption.needsAssigneeAndDate")}</span>}
      </span>
    </label>
  );
}
