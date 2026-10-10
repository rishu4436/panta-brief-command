import "server-only";

/** Live dependencies for the arena route handlers (overridable in tests). */

import { roomRepository } from "@/lib/rooms/store";
import { gatherResolutionEvidence } from "./evidence-server";
import type { FinalizeDeps } from "./finalize";

let evidenceOverride: FinalizeDeps["gatherEvidence"] | undefined;
let clockOverride: (() => number) | undefined;

export function arenaDeps(): FinalizeDeps {
  return { repo: roomRepository(), gatherEvidence: evidenceOverride ?? gatherResolutionEvidence, now: clockOverride ?? Date.now };
}

/** Tests only. */
export function __setArenaDepsForTests(o: { gatherEvidence?: FinalizeDeps["gatherEvidence"]; now?: () => number }) {
  evidenceOverride = o.gatherEvidence;
  clockOverride = o.now;
}
