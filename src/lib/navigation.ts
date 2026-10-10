import { marketHref } from "@/lib/panta/lifecycle";

/**
 * Top navigation model (pure, so it can be tested without a browser).
 *
 * Desktop grouping keeps the bar narrow enough for the search button and a
 * connected wallet chip (~230px) from 1024px up:
 * - Markets, Trade, Positions are always in the bar.
 * - Briefs, Activity, Create (`group: "more"`) sit in the bar at xl+ and in a
 *   "More" menu below xl.
 * - Rooms, Arena, Studio (`group: "community"`) are always in a "Community" menu.
 * The mobile menu lists every item flat.
 */
export type NavGroup = "community" | "more";
export type NavItem = { href: string; label: string; active: boolean; group?: NavGroup };

export const NAV_GROUP_LABEL: Record<NavGroup, string> = { community: "Community", more: "More" };

export function isMarketingPath(pathname: string) {
  return pathname === "/" || pathname === "/about";
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function buildNavItems({ pathname, tab, recentMarketId }: { pathname: string; tab: string | null; recentMarketId: string | null }): {
  marketing: boolean;
  items: NavItem[];
} {
  const marketing = isMarketingPath(pathname);
  if (marketing) {
    return {
      marketing,
      items: [
        { href: "/", label: "Home", active: pathname === "/" },
        { href: "/execute", label: "Trade", active: false },
        { href: "/desk", label: "Markets", active: false },
        { href: "/about", label: "About", active: pathname === "/about" },
      ],
    };
  }
  const onMarket = pathname.startsWith("/markets/");
  return {
    marketing,
    items: [
      { href: "/desk", label: "Markets", active: pathname === "/desk" || onMarket },
      // The brief lives beside the selected market in the workspace: jump to it on a market
      // page, else to the most recently opened market's brief, else to the desk to pick one.
      {
        href: onMarket ? `${pathname}#brief` : recentMarketId ? `${marketHref(recentMarketId)}#brief` : "/desk",
        label: "Briefs",
        active: false,
        group: "more",
      },
      { href: "/execute", label: "Trade", active: pathname.startsWith("/execute") },
      { href: "/book?tab=positions", label: "Positions", active: pathname.startsWith("/book") && tab !== "activity" && tab !== "claims" },
      { href: "/book?tab=activity", label: "Activity", active: pathname.startsWith("/book") && tab === "activity", group: "more" },
      { href: "/rooms", label: "Rooms", active: under(pathname, "/rooms"), group: "community" },
      { href: "/arena", label: "Arena", active: under(pathname, "/arena") || pathname.startsWith("/forecasters/"), group: "community" },
      { href: "/studio", label: "Studio", active: under(pathname, "/studio"), group: "community" },
      { href: "/create", label: "Create", active: under(pathname, "/create"), group: "more" },
    ],
  };
}

/**
 * Desktop bar layout: inline entries in order, with the Community menu where its
 * first item would be. "More" items render inline only at xl+ (`xlOnly`), and the
 * More menu (`belowXl`) collects them below xl.
 */
export type DesktopEntry =
  | { kind: "link"; item: NavItem; xlOnly: boolean }
  | { kind: "menu"; group: NavGroup; label: string; items: NavItem[]; active: boolean; belowXl: boolean };

export function desktopEntries(items: NavItem[]): DesktopEntry[] {
  const out: DesktopEntry[] = [];
  const community = items.filter((i) => i.group === "community");
  const more = items.filter((i) => i.group === "more");
  let communityPlaced = false;
  for (const item of items) {
    if (item.group === "community") {
      if (!communityPlaced) {
        out.push({ kind: "menu", group: "community", label: NAV_GROUP_LABEL.community, items: community, active: community.some((i) => i.active), belowXl: false });
        communityPlaced = true;
      }
    } else {
      out.push({ kind: "link", item, xlOnly: item.group === "more" });
    }
  }
  if (more.length) out.push({ kind: "menu", group: "more", label: NAV_GROUP_LABEL.more, items: more, active: more.some((i) => i.active), belowXl: true });
  return out;
}
