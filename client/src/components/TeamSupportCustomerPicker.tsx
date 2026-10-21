import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { TeamSupportCustomer } from "../api/types";

// Searchable picker over TeamSupport's customer list — the same type-to-filter pattern as the
// TeamSupport user picker in Admin > Users. Picking one stores its ID and name on the project.
export function TeamSupportCustomerPicker({
  value,
  onChange,
  disabled,
  width = 260,
}: {
  value: TeamSupportCustomer | null;
  onChange: (customer: TeamSupportCustomer | null) => void;
  disabled?: boolean;
  width?: number;
}) {
  const { t } = useTranslation();
  // Not every deployment has TeamSupport configured, and the list is ~4,000 customers read in
  // several API calls — so it fails quietly, and is kept for an hour (the server also caches it).
  const { data: customers, isLoading, isError } = useQuery({
    queryKey: ["teamsupport-customers"],
    queryFn: () => api.get<TeamSupportCustomer[]>("/teamsupport-customers"),
    retry: false,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value?.id, value?.name]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value?.name ?? "");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, value]);

  const trimmed = query.trim().toLowerCase();
  // Only matches are listed (never all ~4,000) — nothing shows until something is typed.
  const matches = trimmed ? (customers ?? []).filter((c) => c.name.toLowerCase().includes(trimmed)).slice(0, 10) : [];

  function select(customer: TeamSupportCustomer | null) {
    onChange(customer);
    setQuery(customer?.name ?? "");
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width, maxWidth: "100%" }}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder={isLoading ? t("customerPicker.loading") : isError ? t("customerPicker.unavailable") : t("customerPicker.placeholder")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery(value?.name ?? "");
          }
        }}
      />
      {open && (
        <div
          className="card"
          style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, marginTop: 4, padding: 4, maxHeight: 260, overflowY: "auto" }}
        >
          {value && (
            <div
              className="muted"
              onMouseDown={(e) => {
                e.preventDefault();
                select(null);
              }}
              style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}
            >
              {t("customerPicker.clear")}
            </div>
          )}
          {matches.map((c) => (
            <div
              key={c.id}
              onMouseDown={(e) => {
                e.preventDefault();
                select(c);
              }}
              style={{ padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}
            >
              {c.name}
            </div>
          ))}
          {trimmed && matches.length === 0 && (
            <div className="muted" style={{ padding: "4px 8px" }}>
              {t("customerPicker.noMatches")}
            </div>
          )}
          {!trimmed && !value && (
            <div className="muted" style={{ padding: "4px 8px" }}>
              {t("customerPicker.typeToSearch")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
