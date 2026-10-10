/**
 * Deterministic Studio insights: plain rules over measured numbers only
 * (no AI, no prediction). Each carries the numbers it is based on and the
 * limitation that applies, so nothing reads as more than it is.
 */

import type { DistributionTotals, Insight, Tracked } from "./domain";

export type InsightInput = {
  rooms: { total: number; active: number; archived: number };
  uniqueForecasters: number;
  returningForecasters: number;
  currentForecasts: number;
  revisions: number;
  pendingForecasts: number;
  scoredForecasts: number;
  activeRoomsWithoutForecasts: number;
  topRoom: { title: string; currentForecasts: number } | null;
  distribution: Tracked<DistributionTotals>;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  if (i.rooms.total === 0) {
    out.push({ id: "no-rooms", tone: "info", title: "Create your first room", detail: "Studio numbers appear once you own a room and people forecast in it.", basis: "0 rooms owned by this wallet" });
    return out;
  }
  if (i.uniqueForecasters < 3) {
    out.push({
      id: "sparse",
      tone: "info",
      title: "Too little data for trends yet",
      detail: "With fewer than 3 forecasting wallets, percentages and comparisons would mislead, so they're left out.",
      basis: `${plural(i.uniqueForecasters, "forecasting wallet")} across ${plural(i.rooms.total, "room")}`,
    });
  }
  if (i.activeRoomsWithoutForecasts > 0) {
    out.push({
      id: "empty-rooms",
      tone: "attention",
      title: `${plural(i.activeRoomsWithoutForecasts, "active room")} without forecasts`,
      detail: "Share the room link or embed the widget where your audience already is; the first forecast makes the community number appear.",
      basis: "Current forecasts = 0 in those rooms",
    });
  }
  if (i.topRoom && i.topRoom.currentForecasts > 0 && i.rooms.total > 1) {
    out.push({
      id: "top-room",
      tone: "positive",
      title: `"${i.topRoom.title}" leads participation`,
      detail: `It has the most current forecasts of your rooms.`,
      basis: `${plural(i.topRoom.currentForecasts, "current forecast")}`,
    });
  }
  if (i.uniqueForecasters >= 4 && i.returningForecasters > 0) {
    const share = i.returningForecasters / i.uniqueForecasters;
    out.push({
      id: "returning",
      tone: share >= 0.25 ? "positive" : "info",
      title: `${pct(share)} of forecasting wallets joined more than one of your rooms`,
      detail: "Returning means forecasting in two or more different rooms of yours, not editing a forecast. One person may use several wallets.",
      basis: `${i.returningForecasters} of ${i.uniqueForecasters} wallets`,
    });
  }
  if (i.currentForecasts >= 3 && i.revisions / i.currentForecasts >= 1.5) {
    out.push({
      id: "revisions",
      tone: "positive",
      title: "Forecasters are updating their views",
      detail: "Each forecast was saved more than 1.5 times on average, a sign people come back as news changes.",
      basis: `${i.revisions} revisions for ${i.currentForecasts} current forecasts`,
    });
  }
  if (i.pendingForecasts > 0) {
    out.push({
      id: "pending",
      tone: "info",
      title: `${plural(i.pendingForecasts, "forecast")} waiting for a final result`,
      detail: "They are scored after the market resolves and the result is verified; nothing for you to do.",
      basis: `${i.pendingForecasts} pending, ${i.scoredForecasts} scored`,
    });
  }
  if (i.distribution.tracked) {
    const d = i.distribution.value;
    if (d.embedRequests > 0 && d.ctaClicks === 0) {
      out.push({
        id: "embed-no-clicks",
        tone: "info",
        title: "Your widget is loading, but no click-throughs yet",
        detail: "Embed requests are approximate (CDN caching hides repeats). A click-through is counted only when the room page loads from the widget link.",
        basis: `${d.embedRequests} embed requests, 0 widget click-throughs since ${d.since}`,
      });
    }
    const external = d.sources.filter((s) => s.key.startsWith("src:h:"));
    if (external.length) {
      const top = external[0];
      out.push({
        id: "top-referrer",
        tone: "info",
        title: `Most external visits came from ${top.label}`,
        detail: "Based on the referring site's host name only; many apps and browsers send no referrer, so those visits count as direct.",
        basis: `${top.count} observed views since ${d.since}`,
      });
    }
  } else {
    out.push({
      id: "distribution-new",
      tone: "info",
      title: "Distribution analytics have just started",
      detail: "Views, embed requests and campaign visits are counted from Creator Studio's launch onward; earlier traffic was never recorded.",
      basis: "No distribution counters recorded yet",
    });
  }
  return out;
}
