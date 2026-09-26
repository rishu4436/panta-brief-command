"use client";

import type { ReactNode } from "react";

/** Minimal markdown for desk briefs: headings, bold, italics, lists, paragraphs. */
export function BriefMarkdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);

  return (
    <div className="type-body space-y-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const first = lines[0] || "";

        if (first.startsWith("### ")) {
          return (
            <div key={i}>
              <h4 className="type-section">
                {inline(first.slice(4))}
              </h4>
              <BodyLines lines={lines.slice(1)} />
            </div>
          );
        }
        if (first.startsWith("## ")) {
          return (
            <div key={i}>
              <h3 className="text-[13px] font-semibold tracking-tight text-zinc-100">
                {inline(first.slice(3))}
              </h3>
              {lines.slice(1).map((l, j) => (
                <p key={j} className="mt-1">
                  {inline(l)}
                </p>
              ))}
            </div>
          );
        }
        if (lines.every((l) => /^\s*[-*]\s+/.test(l) || l.trim() === "")) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4 text-zinc-400">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Lines under a heading: consecutive "- " lines become a list, others paragraphs. */
function BodyLines({ lines }: { lines: string[] }) {
  const groups: { list: boolean; items: string[] }[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const isItem = /^\s*[-*]\s+/.test(l);
    const last = groups[groups.length - 1];
    if (last && last.list === isItem && isItem) last.items.push(l);
    else groups.push({ list: isItem, items: [l] });
  }
  return (
    <>
      {groups.map((g, gi) =>
        g.list ? (
          <ul key={gi} className="mt-1 list-disc space-y-1 pl-4 text-zinc-400">
            {g.items.map((l, j) => (
              <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
            ))}
          </ul>
        ) : (
          <p key={gi} className="mt-1">
            {inline(g.items[0])}
          </p>
        ),
      )}
    </>
  );
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={k++} className="font-semibold text-zinc-100">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={k++} className="font-num text-[11px] text-cyan-300/90">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      parts.push(
        <em key={k++} className="italic text-zinc-400">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
