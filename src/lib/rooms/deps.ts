import "server-only";

/** Live dependencies for the room route handlers (overridable in tests). */

import { roomRepository } from "./store";
import { validatePantaMarket, type MarketValidator, type RoomServiceDeps } from "./service";

let validatorOverride: MarketValidator | undefined;
let clockOverride: (() => number) | undefined;

export function roomDeps(): RoomServiceDeps {
  return {
    repo: roomRepository(),
    validateMarket: validatorOverride ?? validatePantaMarket,
    now: clockOverride ?? Date.now,
  };
}

/** Tests only. */
export function __setRoomDepsForTests(o: { validateMarket?: MarketValidator; now?: () => number }) {
  validatorOverride = o.validateMarket;
  clockOverride = o.now;
}
