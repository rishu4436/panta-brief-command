"use client";

import Link from "next/link";
import { useState } from "react";
import { formatFriendlyIst, shortAddr } from "@/lib/format";
import { RoomApiError } from "@/lib/rooms/client";
import { cleanLine, cleanMultiline, DESCRIPTION_MAX, ROOM_SCHEMA_VERSION, TITLE_MAX, TITLE_MIN, type Room } from "@/lib/rooms/domain";
import { updateRoomSettings, useInvalidateStudio, useStudioRoom, type RoomSettingsPatch } from "@/lib/studio/client";
import { campaignUrl, CAMPAIGN_ID_RE, DEFINITIONS, type StudioRoomAnalytics } from "@/lib/studio/domain";
import { EmbedGenerator } from "../rooms/EmbedGenerator";
import { Panel } from "../Panel";
import { ErrorState, SkeletonLoader } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";
import { ChartFrame, ChartState, DailyBars, ForecastDistribution, HBars } from "./StudioCharts";
import { StudioGate } from "./StudioGate";
import { formatPct, InsightsList, Metric, useCopy } from "./StudioParts";


function toRoom(a: StudioRoomAnalytics, wallet: string): Room {
  const r = a.room;
  return {
    roomId: r.roomId,
    slug: r.slug,
    title: r.title,
    description: r.description,
    creatorWallet: wallet,
    marketId: r.marketId,
    visibility: r.visibility,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    schemaVersion: ROOM_SCHEMA_VERSION,
  };
}

type Notice = { tone: "ok" | "err"; text: string } | null;

/**
 * Remounted (key = updatedAt) after every save so the fields show the saved
 * values; the result message lives in the parent so it survives that remount.
 */
function ManageRoom({ a, onSaved, msg, setMsg }: { a: StudioRoomAnalytics; onSaved: () => Promise<unknown>; msg: Notice; setMsg: (n: Notice) => void }) {
  const r = a.room;
  const [title, setTitle] = useState(r.title);
  const [description, setDescription] = useState(r.description);
  const [visibility, setVisibility] = useState(r.visibility);
  const [busy, setBusy] = useState<null | "save" | "archive">(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const patch: RoomSettingsPatch = {};
  if (cleanLine(title) !== r.title) patch.title = cleanLine(title);
  if (cleanMultiline(description) !== r.description) patch.description = cleanMultiline(description);
  if (visibility !== r.visibility) patch.visibility = visibility;
  const dirty = Object.keys(patch).length > 0;
  const titleBad = [...cleanLine(title)].length < TITLE_MIN || [...cleanLine(title)].length > TITLE_MAX;

  const send = async (kind: "save" | "archive", body: RoomSettingsPatch, ok: string) => {
    setBusy(kind);
    setMsg(null);
    try {
      await updateRoomSettings(r.slug, body);
      await onSaved();
      setMsg({ tone: "ok", text: ok });
      setConfirmArchive(false);
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof RoomApiError ? e.message : "Couldn't save. Nothing changed; try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Room settings" subtitle="Only you (the creator wallet) can change these">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !titleBad) void send("save", patch, "Saved.");
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Title</span>
          <input className="field" value={title} maxLength={TITLE_MAX + 20} onChange={(e) => setTitle(e.target.value)} aria-invalid={titleBad} />
          <span className="mt-1 block text-[11px] text-ink-3">{TITLE_MIN}–{TITLE_MAX} characters.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Description</span>
          <textarea className="field min-h-[88px]" value={description} maxLength={DESCRIPTION_MAX + 50} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-ink-2">Visibility</legend>
          <div className="flex flex-wrap gap-3 text-[13px] text-ink-2">
            {(["public", "unlisted"] as const).map((v) => (
              <label key={v} className="inline-flex items-center gap-2">
                <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} className="accent-cyan-400" />
                {v === "public" ? "Public · listed in Rooms" : "Unlisted · link only"}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="rounded-lg border border-line bg-inset/40 px-3 py-2 text-[12px] text-ink-3">
          <p>
            Market <span className="font-addr text-ink-2">{shortAddr(r.marketId, 5)}</span> and address <span className="font-addr text-ink-2">/rooms/{r.slug}</span> can&apos;t be
            changed: forecasts, scores and shared links depend on them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={!dirty || titleBad || busy !== null}>
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>
          {dirty ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTitle(r.title);
                setDescription(r.description);
                setVisibility(r.visibility);
              }}
            >
              Discard
            </button>
          ) : null}
        </div>
      </form>

      <div className="mt-4 border-t border-line pt-4">
        <h3 className="text-[13px] font-semibold text-ink">{r.status === "archived" ? "Archived" : "Archive room"}</h3>
        {r.status === "archived" ? (
          <>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
              Hidden from everyone but you: the room page, embed and debate answer &quot;not found&quot;, it&apos;s out of the directory, and no one can forecast or challenge.
              All forecasts, revisions and scores are kept. Unarchiving restores it exactly as it was; forecasting reopens only if the market is still open.
            </p>
            <button type="button" className="btn btn-primary btn-sm mt-2" disabled={busy !== null} onClick={() => void send("archive", { status: "active" }, "Room unarchived. It's visible again.")}>
              {busy === "archive" ? "Unarchiving…" : "Unarchive room"}
            </button>
          </>
        ) : confirmArchive ? (
          <div className="mt-2 rounded-lg border border-amber-400/35 bg-amber-400/[0.06] p-3 text-[12px] text-amber-100/90">
            <p>Archive &quot;{r.title}&quot;? Visitors and embeds will see &quot;not found&quot; and forecasting stops. Nothing is deleted; you can unarchive any time.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void send("archive", { status: "archived" }, "Room archived.")}>
                {busy === "archive" ? "Archiving…" : "Yes, archive"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmArchive(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">Hide the room and stop new forecasts and challenges. History is kept; you can unarchive later.</p>
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setConfirmArchive(true)}>
              Archive room…
            </button>
          </>
        )}
      </div>
      {msg ? (
        <p role={msg.tone === "err" ? "alert" : "status"} className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${msg.tone === "err" ? "border border-rose-400/40 bg-rose-400/10 text-rose-100" : "border border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-100"}`}>
          {msg.text}
        </p>
      ) : null}
    </Panel>
  );
}

function Analytics({ a }: { a: StudioRoomAnalytics }) {
  const p = a.participation;
  const d = a.distribution;
  return (
    <div className="space-y-4">
      <Panel title="Participation" subtitle="From durable forecast records">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label="Forecasting wallets" value={p.currentForecasts} definition={DEFINITIONS.currentForecasts} />
          <Metric label="Revisions" value={p.revisions} definition={DEFINITIONS.revisions} />
          <Metric label="Community forecast" value={p.meanBps === null ? "—" : `${formatPct(p.meanBps)} YES`} definition="Mean of current forecasts (an opinion, not a Panta price)." />
          <Metric label="Scored" value={p.scored} definition={DEFINITIONS.scored} />
          <Metric label="Pending" value={p.pending} definition={DEFINITIONS.pending} />
          <Metric label="Debate challenges" value={p.challenges} definition={DEFINITIONS.challenges} />
        </dl>
        <div className="mt-3">
          {p.currentForecasts > 0 ? (
            <ChartFrame title="Forecast distribution" description="Current forecasts by YES probability; the thin line is the community mean.">
              <ForecastDistribution buckets={p.distribution} meanBps={p.meanBps} />
            </ChartFrame>
          ) : (
            <ChartState kind="empty">No forecasts in this room yet.</ChartState>
          )}
        </div>
      </Panel>
      <Panel title="Distribution" subtitle="Approximate · last 30 UTC days">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label="Observed views" value={d.tracked ? d.value.views : null} definition={DEFINITIONS.views} />
          <Metric label="Embed requests (approx.)" value={d.tracked ? d.value.embedRequests : null} definition={DEFINITIONS.embedRequests} />
          <Metric label="Widget click-throughs" value={d.tracked ? d.value.ctaClicks : null} definition={DEFINITIONS.ctaClicks} />
        </dl>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {d.tracked ? (
            <>
              <ChartFrame title="Daily counters">
                <DailyBars
                  days={d.value.byDay.map((x) => x.day)}
                  label="Room distribution counters per day"
                  series={[
                    { name: "Views", className: "fill-cyan-400/85", values: d.value.byDay.map((x) => x.views) },
                    { name: "Embed requests", className: "fill-violet-400/80", values: d.value.byDay.map((x) => x.embedRequests) },
                  ]}
                />
              </ChartFrame>
              <ChartFrame title="Sources & campaigns" description={DEFINITIONS.campaigns}>
                {d.value.sources.length || d.value.campaigns.length ? (
                  <HBars
                    label="Observed views by source and campaign"
                    unit="views"
                    rows={[
                      ...d.value.sources.slice(0, 6).map((s) => ({ key: s.key, label: s.label, value: s.count })),
                      ...d.value.campaigns.slice(0, 6).map((c) => ({ key: `c:${c.id}`, label: `Campaign "${c.id}"`, value: c.count })),
                    ]}
                  />
                ) : (
                  <ChartState kind="sparse">No room views observed yet.</ChartState>
                )}
              </ChartFrame>
            </>
          ) : (
            <ChartState kind={d.reason.includes("storage error") ? "error" : "empty"}>{d.reason}</ChartState>
          )}
        </div>
      </Panel>
    </div>
  );
}

function LinkRow({ k, name, url, note, copy, label }: { k: string; name: string; url: string; note?: string; copy: (k: string, t: string) => Promise<void>; label: (k: string, idle: string) => string }) {
  return (
    <li className="rounded-lg border border-line bg-inset/40 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-2">{name}</span>
        <span className="flex gap-1.5">
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            Open
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(k, url)}>
            {label(k, "Copy")}
          </button>
        </span>
      </div>
      <p className="mt-1 truncate font-addr text-[11px] text-ink-3" title={url}>
        {url}
      </p>
      {note ? <p className="mt-0.5 text-[11px] text-ink-3">{note}</p> : null}
    </li>
  );
}

function Toolkit({ a, wallet }: { a: StudioRoomAnalytics; wallet: string }) {
  const { copy, label, result } = useCopy();
  const [cid, setCid] = useState("");
  const cidOk = CAMPAIGN_ID_RE.test(cid);
  const link = cidOk ? campaignUrl(a.links.roomUrl, cid) : null;
  const active = a.room.status === "active";
  return (
    <Panel id="toolkit" title="Distribution toolkit" subtitle="Links that point at the canonical room address">
      {!active ? (
        <ChartState kind="unavailable">This room is archived, so its link, embed and debate show &quot;not found&quot; to visitors. Unarchive it to share again.</ChartState>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            <LinkRow copy={copy} label={label} k="room" name="Share link" url={a.links.roomUrl} />
            {a.links.debateUrl ? <LinkRow copy={copy} label={label} k="debate" name="AI debate" url={a.links.debateUrl} /> : null}
            <LinkRow copy={copy} label={label} k="lb" name="Room leaderboard" url={a.links.leaderboardUrl} />
            <LinkRow copy={copy} label={label} k="arena" name="Forecaster Arena" url={a.links.arenaUrl} />
            <LinkRow copy={copy} label={label} k="profile" name="Your forecaster profile" url={a.links.creatorProfileUrl} note="Shows your own forecasting record, if any." />
          </ul>
          <div className="rounded-lg border border-line bg-inset/40 p-3">
            <label className="block">
              <span className="text-[12px] font-medium text-ink-2">Campaign link</span>
              <input
                className="field mt-1 font-addr"
                value={cid}
                onChange={(e) => setCid(e.target.value.toLowerCase().slice(0, 32))}
                placeholder="e.g. newsletter-oct"
                aria-invalid={cid !== "" && !cidOk}
                aria-describedby="cid-help"
              />
            </label>
            <p id="cid-help" className="mt-1 text-[11px] text-ink-3">
              1–32 lowercase letters, digits or hyphens. Visits that open the room with this link are counted under the campaign (views only, never forecasts or wallets).
            </p>
            {link ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 select-all truncate rounded bg-black/30 px-2 py-1 font-addr text-[11px] text-ink-2" title={link}>
                    {link}
                  </code>
                  {/* Keyed by the link itself, so editing the campaign id resets the feedback. */}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(`camp:${link}`, link)}>
                    {label(`camp:${link}`, "Copy")}
                  </button>
                </div>
                <p role="status" aria-live="polite" className={`mt-1 min-h-[1rem] text-[11px] ${result(`camp:${link}`) === false ? "text-rose-200" : "text-emerald-200"}`}>
                  {result(`camp:${link}`) === true
                    ? "Campaign link copied to your clipboard."
                    : result(`camp:${link}`) === false
                      ? "Couldn't copy automatically. Select the link above and copy it (Ctrl+C / ⌘C)."
                      : ""}
                </p>
              </>
            ) : cid ? (
              <p role="alert" className="mt-1 text-[11px] text-rose-200">
                Use only a–z, 0–9 and hyphens.
              </p>
            ) : null}
          </div>
          <div id="embed">
            <EmbedGenerator room={toRoom(a, wallet)} sessionWallet={wallet} />
          </div>
        </div>
      )}
    </Panel>
  );
}

function RoomDashboard({ wallet, slug }: { wallet: string; slug: string }) {
  const q = useStudioRoom(wallet, slug);
  const invalidate = useInvalidateStudio();
  const [notice, setNotice] = useState<Notice>(null);
  if (q.isPending) return <SkeletonLoader rows={4} label="Loading room analytics" />;
  if (q.isError) {
    const notFound = q.error instanceof RoomApiError && q.error.status === 404;
    return (
      <ErrorState
        title={notFound ? "Not one of your rooms" : "Couldn't load this room"}
        description={notFound ? "This wallet didn't create a room at this address (or it doesn't exist)." : q.error instanceof Error ? q.error.message : "Try again."}
        onRetry={notFound ? undefined : () => void q.refetch()}
      />
    );
  }
  const a = q.data;
  const r = a.room;
  return (
    <div className="space-y-4">
      <header className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={r.status === "archived" ? "neutral" : "success"} size="xs">
            {r.status === "archived" ? "Archived" : "Active"}
          </StatusBadge>
          <StatusBadge tone="neutral" size="xs">
            {r.visibility === "public" ? "Public" : "Unlisted"}
          </StatusBadge>
          <StatusBadge tone="neutral" size="xs">
            {r.lifecycleLabel}
          </StatusBadge>
        </div>
        <h2 className="mt-2 break-words text-[22px] font-semibold text-ink">{r.title}</h2>
        <p className="mt-1 text-[12px] text-ink-3">
          {r.marketTitle ?? "Market title unavailable"} · created <span className="font-num">{formatFriendlyIst(r.createdAt)}</span>
        </p>
        {r.status === "active" ? (
          <a href={r.roomPath} className="btn btn-ghost btn-sm mt-3">
            Open room page
          </a>
        ) : null}
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Analytics a={a} />
          <Panel title="Insights" subtitle="Rules over this room's numbers. No AI.">
            <InsightsList insights={a.insights} />
          </Panel>
        </div>
        <div className="space-y-4">
          <ManageRoom key={r.updatedAt} a={a} onSaved={invalidate} msg={notice} setMsg={setNotice} />
          <Toolkit a={a} wallet={wallet} />
        </div>
      </div>
    </div>
  );
}

export function RoomStudio({ slug }: { slug: string }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <Link href="/studio" className="type-back inline-flex min-h-8 items-center transition">
        ← Creator Studio
      </Link>
      <StudioGate>{(wallet) => <RoomDashboard wallet={wallet} slug={slug} />}</StudioGate>
    </div>
  );
}
