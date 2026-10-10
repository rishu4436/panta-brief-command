import { describe, expect, it } from "vitest";
import { buildNavItems, desktopEntries, type NavItem } from "@/lib/navigation";

const app = (pathname: string, tab: string | null = null) => buildNavItems({ pathname, tab, recentMarketId: null }).items;
const activeLabels = (items: NavItem[]) => items.filter((i) => i.active).map((i) => i.label);

describe("top navigation model", () => {
  it("keeps every app item in the flat (mobile) list", () => {
    expect(app("/desk").map((i) => i.label)).toEqual(["Markets", "Briefs", "Trade", "Positions", "Activity", "Rooms", "Arena", "Studio", "Create"]);
  });

  it("groups Rooms/Arena/Studio under Community and Briefs/Activity/Create under More", () => {
    const entries = desktopEntries(app("/desk"));
    const shape = entries.map((e) => (e.kind === "menu" ? `${e.label}[${e.items.map((i) => i.label).join(",")}]${e.belowXl ? "<xl" : ""}` : `${e.item.label}${e.xlOnly ? "@xl" : ""}`));
    expect(shape).toEqual(["Markets", "Briefs@xl", "Trade", "Positions", "Activity@xl", "Community[Rooms,Arena,Studio]", "Create@xl", "More[Briefs,Activity,Create]<xl"]);
  });

  it("every item is reachable on desktop at both breakpoints", () => {
    const entries = desktopEntries(app("/desk"));
    const inline = (xl: boolean) =>
      entries.flatMap((e) => (e.kind === "link" ? (e.xlOnly && !xl ? [] : [e.item.label]) : e.belowXl && xl ? [] : e.items.map((i) => i.label)));
    const all = app("/desk").map((i) => i.label).sort();
    expect(inline(true).sort()).toEqual(all);
    expect(inline(false).sort()).toEqual(all);
  });

  it.each([
    ["/studio", ["Studio"], "community"],
    ["/studio/rooms/test-room", ["Studio"], "community"],
    ["/arena", ["Arena"], "community"],
    ["/forecasters/abc", ["Arena"], "community"],
    ["/rooms", ["Rooms"], "community"],
    ["/rooms/some-room", ["Rooms"], "community"],
    ["/create", ["Create"], "more"],
    ["/desk", ["Markets"], null],
  ] as const)("highlights the current section on %s (and its menu)", (path, labels, menu) => {
    const items = app(path);
    expect(activeLabels(items)).toEqual(labels);
    const menus = desktopEntries(items).filter((e) => e.kind === "menu");
    for (const m of menus) if (m.kind === "menu") expect(m.active).toBe(m.group === menu);
  });

  it("does not treat look-alike paths as active", () => {
    expect(activeLabels(app("/studiox"))).toEqual([]);
    expect(activeLabels(app("/roomsy"))).toEqual([]);
  });

  it("positions vs activity tabs", () => {
    expect(activeLabels(app("/book", "positions"))).toEqual(["Positions"]);
    expect(activeLabels(app("/book", "activity"))).toEqual(["Activity"]);
  });

  it("marketing pages have no groups", () => {
    const m = buildNavItems({ pathname: "/", tab: null, recentMarketId: null });
    expect(m.marketing).toBe(true);
    expect(desktopEntries(m.items).every((e) => e.kind === "link" && !e.xlOnly)).toBe(true);
  });
});
