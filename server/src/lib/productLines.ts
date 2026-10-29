// Product lines: APM's own software lines (same ids as the SoftwareLine table; R & D and
// Support have no products of their own), told apart by how TeamSupport product names start
// ("TRIO Cash Receipting", "Spectrum - FLEXIBILL", "RM-NG"...). Used by fix playbooks (one
// line each) and by Ticket Finder's similar-ticket research (never mixes lines). Products of
// other lines (SF, A+, ICS...) have no line here.
export const PRODUCT_LINES: { id: string; name: string; pattern: RegExp }[] = [
  { id: "trio", name: "TRIO", pattern: /^TRIO\b/i },
  { id: "msi", name: "MSI", pattern: /^MSI\b/i },
  { id: "spectrum", name: "Spectrum", pattern: /^Spectrum\b/i },
  { id: "openwindow", name: "OpenWindow", pattern: /^Open\s?Window\b/i },
  { id: "resourcemate", name: "ResourceMate", pattern: /^(RM\s*-|ResourceMate\b)/i },
];

export function productLineOf(product: string | null): string | null {
  const p = (product ?? "").trim();
  return PRODUCT_LINES.find((l) => l.pattern.test(p))?.id ?? null;
}

export function productLineName(id: string | null): string | null {
  return PRODUCT_LINES.find((l) => l.id === id)?.name ?? null;
}
