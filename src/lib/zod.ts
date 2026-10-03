/**
 * The app's single zod entry. Every schema module imports `z` from here, so
 * this runs before any schema is constructed.
 *
 * Zod 4 probes for JIT support with `Function("")` when an object schema is
 * constructed. In the browser the CSP has no 'unsafe-eval', so that probe is
 * blocked and reported as a CSP violation, after which zod uses its
 * interpreter anyway. Turning JIT off in the browser up front gives the same
 * behaviour without the violation. The server (no CSP) keeps the JIT.
 */
import { z } from "zod";

if (typeof window !== "undefined") z.config({ jitless: true });

export { z };
