"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCatalog } from "@/lib/data/hooks";
import { formatFriendlyIst, marketLabel, shortAddr } from "@/lib/format";
import type { Market } from "@/lib/panta/domain";
import { marketState } from "@/lib/panta/lifecycle";
import { RoomApiError, useRooms } from "@/lib/rooms/client";
import { roomPath, type Room } from "@/lib/rooms/domain";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";
import { IconArrowRight, IconLayers } from "../ui/Icons";

function RoomCardMarket({ marketId, row, catalogPending, catalogError }: { marketId: string; row: Market | undefined; catalogPending: boolean; catalogError: unknown }) {
  if (!row) {
    if (catalogPending) return <Skeleton className="h-4 w-2/3" />;
    return (
      <p className="text-[12px] text-ink-3">
        {catalogError ? "Panta market list unavailable right now." : "Market status loads on the room page."}{" "}
        <span className="font-addr">{shortAddr(marketId, 4)}</span>
      </p>
    );
  }
  const state = marketState({ marketId, market: row });
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="line-clamp-2 text-[13px] text-ink-2">{marketLabel(row, { max: 120 })}</p>
      <div>
        <StatusBadge tone={state.tone as StatusTone} size="xs">
          {state.label}
        </StatusBadge>
      </div>
    </div>
  );
}

function RoomCard({ room, row, catalogPending, catalogError }: { room: Room; row: Market | undefined; catalogPending: boolean; catalogError: unknown }) {
  return (
    <li className="card card-hover group relative flex flex-col p-4">
      <h2 className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">
        <Link href={roomPath(room.slug)} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
          {room.title}
        </Link>
      </h2>
      {room.description ? (
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-3">{room.description}</p>
      ) : null}
      <div className="mt-3 rounded-xl border border-line bg-inset/50 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">Linked Panta market</p>
        <RoomCardMarket marketId={room.marketId} row={row} catalogPending={catalogPending} catalogError={catalogError} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] text-ink-3">
        <span>
          by <span className="font-addr text-ink-2">{shortAddr(room.creatorWallet, 4)}</span>
        </span>
        <span className="font-num">{formatFriendlyIst(room.createdAt).replace(/, \d{4}/, "")}</span>
      </div>
    </li>
  );
}

export function RoomsDirectory() {
  const rooms = useRooms();
  const catalog = useCatalog();
  const byId = useMemo(() => new Map((catalog.data?.items ?? []).map((m) => [m.marketId, m])), [catalog.data]);
  const list = rooms.data?.rooms ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Community</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Prediction Rooms</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
            Rooms are wallet-owned community spaces, each built around one live Panta market. The market&apos;s prices and status always come
            straight from Panta.
          </p>
        </div>
        <Link href="/rooms/create" className="btn btn-primary">
          Create Room
        </Link>
      </div>

      {rooms.isPending ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading rooms">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="card space-y-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-16 w-full" />
            </li>
          ))}
        </ul>
      ) : rooms.isError ? (
        <ErrorState
          title={rooms.error instanceof RoomApiError && rooms.error.code === "ROOMS_STORE_UNCONFIGURED" ? "Rooms aren't available on this deployment yet" : "Couldn't load rooms"}
          description={rooms.error instanceof Error ? rooms.error.message : "Try again."}
          onRetry={() => void rooms.refetch()}
        />
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconLayers className="h-5 w-5" />}
            title="No rooms yet"
            description="Start the first Prediction Room: pick a live Panta market, give it a name, and share the link. You'll verify your wallet with a free signature; no transaction, no fees."
            action={
              <Link href="/rooms/create" className="btn btn-primary">
                Create the first room <IconArrowRight className="h-4 w-4" />
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => (
            <RoomCard key={r.roomId} room={r} row={byId.get(r.marketId)} catalogPending={catalog.isPending} catalogError={catalog.error} />
          ))}
        </ul>
      )}
    </div>
  );
}
