import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Store credentials are blanked so tests never reach a real Redis through the app's own
    // env lookups (a box shell may export the production Upstash vars). The opt-in live run
    // passes credentials via PHASE8_UPSTASH_ENV_FILE only (test/helpers/isolated-redis.ts).
    env: { PANTA_API_KEY: "pk_test_vitest_dummy", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "" },
  },
});
