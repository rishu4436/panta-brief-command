import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Pre-existing fetch-on-mount / localStorage-sync effects flagged by the
  // React Compiler rule `set-state-in-effect`. Kept visible as warnings (not
  // errors) for these files only; new files still get the error. Remove this
  // block once the shared client data layer (audit P2) replaces these effects.
  {
    files: [
      "src/components/AttributedTrades.tsx",
      "src/components/BookPanel.tsx",
      "src/components/CommandPalette.tsx",
      "src/components/HotTapeRail.tsx",
      "src/components/MarketDetail.tsx",
      "src/components/MarketList.tsx",
      "src/components/Shell.tsx",
      "src/components/WatchStar.tsx",
      "src/hooks/useLocalIds.ts",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
