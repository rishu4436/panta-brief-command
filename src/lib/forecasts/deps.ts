import "server-only";

/** Live dependencies for the forecast route handlers (overridable in tests). */

import { roomRepository } from "@/lib/rooms/store";
import type { ForecastServiceDeps, ForecastWindowCheck } from "./service";
import { cachedForecastWindow, checkForecastWindowForWrite } from "./window-server";

let windowOverride: ForecastWindowCheck | undefined;
let clockOverride: (() => number) | undefined;

export function forecastDeps(): ForecastServiceDeps & { readWindow: ForecastWindowCheck } {
  return {
    repo: roomRepository(),
    checkWindow: windowOverride ?? checkForecastWindowForWrite,
    readWindow: windowOverride ?? cachedForecastWindow,
    now: clockOverride ?? Date.now,
  };
}

/** Tests only. */
export function __setForecastDepsForTests(o: { checkWindow?: ForecastWindowCheck; now?: () => number }) {
  windowOverride = o.checkWindow;
  clockOverride = o.now;
}
