import { QueryClient } from "@tanstack/react-query";

/**
 * One QueryClient per browser tab: every view reads the same cache, so the
 * catalog, market details, tape and ledger are fetched once and deduped while
 * in flight.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
