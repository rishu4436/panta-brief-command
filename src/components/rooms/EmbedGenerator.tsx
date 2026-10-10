"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { DEFAULT_EMBED_OPTIONS, embedHeight, embedQuery, type EmbedOptions } from "@/lib/embed/options";
import { embedUrl, iframeSnippet } from "@/lib/embed/snippet";
import { call } from "@/lib/rooms/client";
import type { Room } from "@/lib/rooms/domain";
import { Panel } from "../Panel";
import { Skeleton } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";

type EmbedConfig = { slug: string; title: string; visibility: string; origin: string; roomUrl: string; embedPath: string };

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(`${key}:failed`);
    }
    setTimeout(() => setCopied(null), 2200);
  };
  const label = (key: string, idle: string) => (copied === key ? "Copied" : copied === `${key}:failed` ? "Copy failed" : idle);
  return { copy, label };
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; text: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <fieldset className="min-w-0">
      <legend id={id} className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        {label}
      </legend>
      <div className="inline-flex rounded-lg border border-line bg-inset/60 p-0.5" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={`forecast-tap min-h-9 rounded-md px-3 text-[12px] font-medium transition ${value === o.v ? "bg-elevated text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"}`}
          >
            {o.text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const GUIDES: { name: string; text: string }[] = [
  { name: "WordPress (self-hosted)", text: "Add a Custom HTML block and paste the embed code. On WordPress.com, iframes only work on plans that allow custom code (plugin-enabled plans); otherwise paste the room link." },
  { name: "Webflow", text: "Drag a Code Embed element onto the page and paste the embed code, then publish." },
  { name: "Ghost", text: "Insert an HTML card (type /html in the editor) and paste the embed code." },
  { name: "Notion", text: "Type /embed and paste the embed URL (not the iframe code). Notion decides how to show external pages; if it shows a link card instead, use the room link." },
  { name: "Substack", text: "Substack posts don't accept custom iframes or HTML. Paste the room link instead; it appears as a link or preview." },
];

/** Creator-only embed tools. Hidden (renders nothing) unless the server confirms the session wallet is the creator. */
export function EmbedGenerator({ room, sessionWallet }: { room: Room; sessionWallet: string | null }) {
  const isCreator = Boolean(sessionWallet) && sessionWallet === room.creatorWallet;
  const cfg = useQuery({
    queryKey: ["room-embed-config", room.slug, sessionWallet],
    queryFn: () => call<EmbedConfig>(`/api/rooms/${encodeURIComponent(room.slug)}/embed`),
    enabled: isCreator,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [o, setO] = useState<EmbedOptions>(DEFAULT_EMBED_OPTIONS);
  const [previewWidth, setPreviewWidth] = useState<"full" | "320">("full");
  const { copy, label } = useCopy();
  if (!isCreator || cfg.isError) return null;

  const set = (patch: Partial<EmbedOptions>) => setO((p) => ({ ...p, ...patch }));
  const c = cfg.data;
  const snippet = c ? iframeSnippet(c.origin, c.slug, c.title, o) : "";
  const url = c ? embedUrl(c.origin, c.slug, o) : "";
  const preview = c ? `${c.embedPath}?${embedQuery(o)}` : "";

  return (
    <Panel id="embed" title="Embed this room" subtitle="Creator tools" action={<StatusBadge tone="success" size="xs">Only you see this</StatusBadge>}>
      {!c ? (
        <div className="space-y-2" role="status" aria-label="Loading embed tools">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[12px] leading-relaxed text-ink-3">
            Put this room&apos;s live community forecast on any website. The widget is read-only: no wallet, no cookies, no scripts. Visitors click through to
            forecast here.
            {c.visibility === "unlisted" ? " This room is unlisted: anyone who sees the widget can open it through its link." : ""}
          </p>
          <div className="flex flex-wrap gap-4">
            <Segmented label="Theme" value={o.theme} options={[{ v: "dark", text: "Dark" }, { v: "light", text: "Light" }]} onChange={(theme) => set({ theme })} />
            <Segmented label="Layout" value={o.layout} options={[{ v: "standard", text: "Standard" }, { v: "compact", text: "Compact" }]} onChange={(layout) => set({ layout })} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
            <label className={`inline-flex min-h-9 items-center gap-2 ${o.layout === "compact" ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={o.dist} disabled={o.layout === "compact"} onChange={(e) => set({ dist: e.target.checked })} className="h-4 w-4 accent-cyan-400" />
              Show distribution{o.layout === "compact" ? " (standard layout only)" : ""}
            </label>
            <label className="inline-flex min-h-9 items-center gap-2">
              <input type="checkbox" checked={o.market} onChange={(e) => set({ market: e.target.checked })} className="h-4 w-4 accent-cyan-400" />
              Show Panta market line
            </label>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Live preview</p>
              <Segmented label="Preview width" value={previewWidth} options={[{ v: "full", text: "Full" }, { v: "320", text: "320 px" }]} onChange={setPreviewWidth} />
            </div>
            <div className={`overflow-hidden rounded-xl border border-dashed border-line p-2 ${o.theme === "light" ? "bg-white" : "bg-inset/40"}`}>
              <iframe
                key={preview}
                src={preview}
                title={`Preview: ${c.title} embed`}
                height={embedHeight(o)}
                style={{ colorScheme: "normal" }}
                className={`block border-0 ${previewWidth === "320" ? "mx-auto w-[320px] max-w-full" : "w-full"}`}
                loading="lazy"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </div>

          <div>
            <label htmlFor="embed-code" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
              Embed code
            </label>
            <textarea id="embed-code" readOnly value={snippet} rows={4} className="forecast-field w-full resize-none rounded-lg border border-line bg-inset/60 p-2 font-addr text-[11.5px] leading-relaxed text-ink-2" onFocus={(e) => e.currentTarget.select()} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary btn-sm forecast-tap" onClick={() => copy("code", snippet)} aria-live="polite">
                {label("code", "Copy embed code")}
              </button>
              <button type="button" className="btn btn-secondary btn-sm forecast-tap" onClick={() => copy("url", url)} aria-live="polite">
                {label("url", "Copy embed URL")}
              </button>
              <button type="button" className="btn btn-ghost btn-sm forecast-tap" onClick={() => copy("room", c.roomUrl)} aria-live="polite">
                {label("room", "Copy room link")}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-3">
              Links point to <span className="font-addr">{c.origin}</span>. Suggested height {embedHeight(o)} px; the widget scrolls inside if a narrow page needs more.
            </p>
          </div>

          <details className="rounded-xl border border-line bg-inset/40 p-3 text-[12px]">
            <summary className="cursor-pointer font-medium text-ink-2">Where to paste it</summary>
            <ul className="mt-2 space-y-2">
              {GUIDES.map((g) => (
                <li key={g.name}>
                  <span className="font-semibold text-ink-2">{g.name}:</span> <span className="text-ink-3">{g.text}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Panel>
  );
}
