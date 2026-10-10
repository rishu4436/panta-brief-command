import "server-only";

import { connection } from "next/server";
import { isReadOnlyDeployment } from "@/lib/deploy-env";
import { resolveRoomStoreConfig } from "./store";

/**
 * Whether community storage is configured for this request's deployment.
 * Reads configuration only (no store access), so pages can show the honest
 * unavailable state up front instead of firing requests that fail with 503.
 * `connection()` keeps the answer per-request rather than baked in at build.
 */
export async function communityAvailability(): Promise<{ available: boolean; readOnly: boolean }> {
  await connection();
  return { available: resolveRoomStoreConfig().kind !== "unavailable", readOnly: isReadOnlyDeployment() };
}

/**
 * Same answer without opting the page into per-request rendering: for static
 * pages (the landing), where the deployment's environment is fixed at build
 * time just like the layout's read-only banner.
 */
export function communityAvailabilityAtBuild(): { available: boolean; readOnly: boolean } {
  return { available: resolveRoomStoreConfig().kind !== "unavailable", readOnly: isReadOnlyDeployment() };
}
