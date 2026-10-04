/**
 * At most one run in flight: a call while one is running joins it (same
 * promise, same result or error) instead of starting a second request. The
 * function is passed per call so a React component can hand in its current
 * closure. Used for the ticket's quote and build (each has its own retry loop
 * in orders.ts; a double trigger must not start a second one).
 */
export class SingleFlight<T> {
  private current: Promise<T> | null = null;

  get running(): boolean {
    return this.current !== null;
  }

  run(fn: () => Promise<T>): Promise<T> {
    if (this.current) return this.current;
    let started: Promise<T>;
    try {
      started = fn();
    } catch (e) {
      started = Promise.reject(e);
    }
    const p = started.finally(() => {
      if (this.current === p) this.current = null;
    });
    this.current = p;
    return p;
  }
}
