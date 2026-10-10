"use client";

import Link from "next/link";
import { formatFriendlyIst, shortAddr } from "@/lib/format";
import { useRoomSession } from "@/lib/rooms/client";
import type { Room } from "@/lib/rooms/domain";
import { Panel } from "../Panel";
import { StatusBadge } from "../ui/StatusBadge";
import { RoomMarketPanel } from "./RoomMarketPanel";
import { ShareRoomButton } from "./ShareRoomButton";

/**
 * Sections planned for later phases. Shown as clearly labelled placeholders
 * with no numbers, avatars or sample rows: nothing here is operational yet.
 */
const UPCOMING: { title: string; body: string }[] = [
  { title: "Community forecasts", body: "Members will post free probability forecasts on this market. Not open yet." },
  { title: "Prediction leaderboard", body: "Forecast accuracy will be ranked once forecasts exist and the market resolves. Not open yet." },
  { title: "Discussion & research", body: "Threads for evidence, sources and arguments. Not open yet." },
  { title: "Participant activity", body: "Who joined and what they did in this room. Not open yet." },
];

export function RoomDetail({ room, canonicalUrl }: { room: Room; canonicalUrl: string }) {
  const session = useRoomSession();
  const isCreator = session.data?.wallet === room.creatorWallet;
  return (
    <div className="space-y-5 animate-fade-in">
      <Link href="/rooms" className="type-back inline-flex min-h-8 items-center transition">
        ← Rooms
      </Link>

      <header className="card overflow-hidden">
        <div className="border-b border-line bg-gradient-to-br from-cyan-400/[0.06] via-transparent to-violet-500/[0.05] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">Prediction Room</p>
            {room.visibility === "unlisted" ? <StatusBadge tone="neutral" size="xs">Unlisted · link only</StatusBadge> : null}
            {isCreator ? <StatusBadge tone="success" size="xs">You created this room</StatusBadge> : null}
          </div>
          <div className="mt-2 flex items-start gap-3">
            <h1 className="type-display min-w-0 flex-1 break-words">{room.title}</h1>
            <ShareRoomButton url={canonicalUrl} title={room.title} text={room.description || undefined} />
          </div>
          {room.description ? (
            <p className="mt-3 max-w-3xl whitespace-pre-line break-words text-[14px] leading-relaxed text-ink-2">{room.description}</p>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">The creator didn&apos;t add a description.</p>
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-2 px-5 py-4 text-[12px] sm:grid-cols-3 sm:px-6">
          <div>
            <dt className="text-ink-3">Creator</dt>
            <dd className="mt-0.5 font-addr text-ink-2" title={room.creatorWallet}>
              {shortAddr(room.creatorWallet, 5)} <span className="text-ink-3">· wallet-verified</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Created</dt>
            <dd className="mt-0.5 font-num text-ink-2">{formatFriendlyIst(room.createdAt)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">Room link</dt>
            <dd className="mt-0.5 truncate font-addr text-ink-2" title={canonicalUrl}>
              {canonicalUrl.replace(/^https?:\/\//, "")}
            </dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <RoomMarketPanel marketId={room.marketId} />

        <Panel title="Coming to rooms" subtitle="Not operational yet">
          <ul className="space-y-3">
            {UPCOMING.map((u) => (
              <li key={u.title} className="rounded-xl border border-dashed border-line bg-inset/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-ink-2">{u.title}</h3>
                  <StatusBadge tone="neutral" size="xs">Coming soon</StatusBadge>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{u.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
