/**
 * Deployment environment, decided on the server from Vercel's system env.
 *
 * Read-only ("restricted") deployments refuse every financial write on the
 * server: Panta POST routes (quote/build/submit/verify/report, claims, market
 * creation) and Solana sendTransaction / simulateTransaction through /api/rpc.
 *
 *  - VERCEL_ENV=production            → full (unchanged behaviour)
 *  - VERCEL_ENV=preview / development / any other value → restricted
 *  - running on Vercel but VERCEL_ENV missing → restricted (fail closed)
 *  - local (no VERCEL_ENV, not on Vercel) → full, as before; set
 *    APP_READ_ONLY=1 to rehearse the preview restrictions locally.
 *
 * APP_READ_ONLY=1 restricts any deployment; nothing un-restricts a non-production one.
 */

type Env = Record<string, string | undefined>;

export type DeploymentMode = { env: "production" | "preview" | "development" | "other" | "local"; readOnly: boolean };

export const PREVIEW_READ_ONLY = "PREVIEW_READ_ONLY";
export const PREVIEW_READ_ONLY_DETAIL =
  "This is a read-only preview deployment: trading, claims and market creation are disabled on the server.";

export function deploymentMode(env: Env = process.env): DeploymentMode {
  const v = (env.VERCEL_ENV || "").trim().toLowerCase();
  const forced = (env.APP_READ_ONLY || "").trim() === "1";
  if (v === "production") return { env: "production", readOnly: forced };
  if (v === "preview" || v === "development") return { env: v, readOnly: true };
  if (v) return { env: "other", readOnly: true };
  const onVercel = (env.VERCEL || "").trim() === "1" && Boolean((env.VERCEL_URL || "").trim());
  if (onVercel) return { env: "other", readOnly: true };
  return { env: "local", readOnly: forced };
}

export function isReadOnlyDeployment(env: Env = process.env): boolean {
  return deploymentMode(env).readOnly;
}
