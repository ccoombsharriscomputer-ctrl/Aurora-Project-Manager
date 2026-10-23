import type { ReactNode } from "react";

// Pasted web addresses (https://..., http://..., www....) become clickable links. Built as
// React elements rather than HTML, so nothing typed into a comment can inject markup. A full
// stop or closing bracket right after an address stays outside the link.
const URL_PATTERN = /(https?:\/\/|www\.)[^\s<]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]>"']+$/;

export function LinkifiedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const trailing = match[0].match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const url = trailing ? match[0].slice(0, -trailing.length) : match[0];
    if (!url || /^(https?:\/\/|www\.)$/i.test(url)) continue;
    if (start > last) parts.push(text.slice(last, start));
    const href = /^www\./i.test(url) ? `http://${url}` : url;
    parts.push(
      <a key={start} href={href} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
