import { useEffect, useRef, useState } from "react";

export interface PickerItem {
  id: string;
  name: string;
}

export interface PickerLabels {
  placeholder: string;
  loading: string;
  unavailable: string;
  clear: string;
  noMatches: string;
  typeToSearch: string;
}

// Type-to-filter picker over a long list (the same pattern as the TeamSupport user picker in
// Admin > Users). Shows matches only — never the whole list — unless browseItems is given, which
// is what shows before anything is typed (e.g. the current software line's products).
export function SearchablePicker({
  items,
  value,
  onChange,
  labels,
  isLoading,
  isError,
  disabled,
  width = 260,
  browseItems,
}: {
  items: PickerItem[];
  value: PickerItem | null;
  onChange: (item: PickerItem | null) => void;
  labels: PickerLabels;
  isLoading?: boolean;
  isError?: boolean;
  disabled?: boolean;
  width?: number;
  browseItems?: PickerItem[];
}) {
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
  // Typing on top of a picked value filters by what's typed; only a still-untouched box shows
  // the browse list.
  const browsing = !trimmed || trimmed === (value?.name ?? "").toLowerCase();
  const matches = browsing
    ? (browseItems ?? []).slice(0, 60)
    : items.filter((c) => c.name.toLowerCase().includes(trimmed)).slice(0, 10);

  function select(item: PickerItem | null) {
    onChange(item);
    setQuery(item?.name ?? "");
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width, maxWidth: "100%" }}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder={isLoading ? labels.loading : isError ? labels.unavailable : labels.placeholder}
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
              {labels.clear}
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
          {!browsing && matches.length === 0 && (
            <div className="muted" style={{ padding: "4px 8px" }}>
              {labels.noMatches}
            </div>
          )}
          {browsing && matches.length === 0 && !value && (
            <div className="muted" style={{ padding: "4px 8px" }}>
              {labels.typeToSearch}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
