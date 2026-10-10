"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState, type ReactNode } from "react";
import { shortAddr } from "@/lib/format";
import { RoomApiError, signOutRooms, useInvalidateRooms, useRoomSession, verifyWalletOwnership } from "@/lib/rooms/client";
import { WalletButton } from "../WalletButton";
import { ErrorState, SkeletonLoader } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";

function isWalletRejection(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /reject|declin|cancel|denied/i.test(msg);
}

function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mx-auto max-w-xl p-5 sm:p-6" aria-labelledby="studio-gate-title">
      <h2 id="studio-gate-title" className="text-[17px] font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-3">{children}</div>
    </section>
  );
}

/**
 * Creator Studio access: disconnected → connect; connected but not signed in
 * (or signed in as a different wallet) → free sign-in signature; signed in →
 * children with the SESSION wallet. The server re-checks the session on every
 * Studio request; this gate is only the UI.
 */
export function StudioGate({ children }: { children: (wallet: string) => ReactNode }) {
  const { publicKey, connected, signMessage, wallet } = useWallet();
  const session = useRoomSession();
  const inval = useInvalidateRooms();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedAddr = publicKey?.toBase58() ?? null;
  const sessionWallet = session.data?.wallet ?? null;

  if (session.isPending) return <SkeletonLoader rows={3} label="Checking your sign-in" />;
  if (session.isError) {
    return <ErrorState title="Couldn't check your sign-in" description={session.error instanceof Error ? session.error.message : "Try again."} onRetry={() => void session.refetch()} />;
  }

  if (!connected || !connectedAddr) {
    return (
      <GateCard title="Connect your wallet to open Creator Studio">
        <p>Creator Studio shows the rooms your wallet created, how people forecast in them, and where your visitors come from.</p>
        <div className="flex flex-wrap items-center gap-3">
          <WalletButton />
          <span className="text-[12px]">Phantom or Solflare. Connecting doesn&apos;t sign or send anything.</span>
        </div>
      </GateCard>
    );
  }

  if (sessionWallet && sessionWallet === connectedAddr) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
          <StatusBadge tone="success" size="xs">
            Signed in
          </StatusBadge>
          <span className="font-addr text-ink-2" title={sessionWallet}>
            {shortAddr(sessionWallet, 5)}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await signOutRooms().catch(() => undefined);
              await inval.session();
            }}
          >
            Sign out
          </button>
        </div>
        {children(sessionWallet)}
      </div>
    );
  }

  const verify = async () => {
    if (!signMessage) return;
    setBusy(true);
    setError(null);
    try {
      await verifyWalletOwnership(connectedAddr, signMessage);
      await inval.session();
    } catch (e) {
      setError(isWalletRejection(e) ? "You declined the signature request. Nothing was signed." : e instanceof RoomApiError ? e.message : "The wallet couldn't sign the message. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateCard title="Sign in to see your rooms">
      <p>Sign a short text message to prove you own {shortAddr(connectedAddr, 4)}. It&apos;s free, it isn&apos;t a transaction, and it can&apos;t move funds.</p>
      {sessionWallet && sessionWallet !== connectedAddr ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
          This browser is signed in as {shortAddr(sessionWallet, 4)}, but {shortAddr(connectedAddr, 4)} is connected. Sign in with the connected wallet to see its rooms.
        </p>
      ) : null}
      {!signMessage ? (
        <p role="alert" className="rounded-lg border border-amber-400/35 bg-amber-400/[0.08] px-3 py-2 text-[12px] text-amber-100">
          {wallet?.adapter.name ?? "This wallet"} can&apos;t sign messages. Connect Phantom or Solflare.
        </p>
      ) : (
        <button type="button" className="btn btn-primary" onClick={verify} disabled={busy}>
          {busy ? "Waiting for signature…" : `Sign in as ${shortAddr(connectedAddr, 4)}`}
        </button>
      )}
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">
          {error}
        </p>
      ) : null}
    </GateCard>
  );
}
