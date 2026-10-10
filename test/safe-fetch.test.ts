/**
 * Safe fetcher for untrusted URLs (AI Debate Arena evidence). DNS and the
 * HTTPS transport are injected: no network is used here.
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  SafeFetchError,
  htmlToText,
  isPublicAddress,
  safeFetch,
  validateUrlSyntax,
  type ResolvedAddress,
  type Resolver,
  type Transport,
  type TransportResponse,
} from "@/lib/net/safe-fetch";

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };
const resolver =
  (map: Record<string, string[]> = {}): Resolver =>
  async (host) => {
    const ips = map[host] ?? [PUBLIC.address];
    return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };

async function* chunks(...parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === "string" ? new TextEncoder().encode(p) : p;
}
const resp = (status: number, headers: Record<string, string>, body: AsyncIterable<Uint8Array> = chunks("")): TransportResponse => ({
  status,
  headers,
  body,
  abort: () => undefined,
});

type Call = { url: string; pinned: string };
function transport(routes: Record<string, () => TransportResponse | Promise<TransportResponse>>, calls: Call[] = []): Transport {
  return async (url, pinned) => {
    calls.push({ url: url.href, pinned: pinned.address });
    const r = routes[url.href];
    if (!r) throw new Error(`unexpected ${url.href}`);
    return r();
  };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof SafeFetchError ? e.code : `THREW:${(e as Error).message}`;
  }
}

describe("safe fetch: URL + address policy (test 22)", () => {
  it.each([
    ["http://example.com/", "SCHEME_NOT_ALLOWED"],
    ["ftp://example.com/x", "SCHEME_NOT_ALLOWED"],
    ["javascript:alert(1)", "SCHEME_NOT_ALLOWED"],
    ["file:///etc/passwd", "SCHEME_NOT_ALLOWED"],
    ["data:text/html,hi", "SCHEME_NOT_ALLOWED"],
    ["https://localhost/", "HOST_NOT_ALLOWED"],
    ["https://LOCALHOST./", "HOST_NOT_ALLOWED"],
    ["https://foo.localhost/", "HOST_NOT_ALLOWED"],
    ["https://printer.local/", "HOST_NOT_ALLOWED"],
    ["https://metadata.google.internal/computeMetadata/v1/", "HOST_NOT_ALLOWED"],
    ["https://intranet/", "HOST_NOT_ALLOWED"],
    ["https://127.0.0.1/", "ADDRESS_NOT_ALLOWED"],
    ["https://127.1/", "ADDRESS_NOT_ALLOWED"],
    ["https://2130706433/", "ADDRESS_NOT_ALLOWED"], // decimal 127.0.0.1
    ["https://0177.0.0.1/", "ADDRESS_NOT_ALLOWED"], // octal
    ["https://0x7f000001/", "ADDRESS_NOT_ALLOWED"], // hex
    ["https://0x7f.0.0.1/", "ADDRESS_NOT_ALLOWED"],
    ["https://10.0.0.5/", "ADDRESS_NOT_ALLOWED"],
    ["https://172.16.3.4/", "ADDRESS_NOT_ALLOWED"],
    ["https://192.168.1.1/", "ADDRESS_NOT_ALLOWED"],
    ["https://100.64.0.1/", "ADDRESS_NOT_ALLOWED"], // CGNAT
    ["https://169.254.169.254/latest/meta-data/", "ADDRESS_NOT_ALLOWED"], // metadata
    ["https://0.0.0.0/", "ADDRESS_NOT_ALLOWED"],
    ["https://224.0.0.1/", "ADDRESS_NOT_ALLOWED"],
    ["https://[::1]/", "ADDRESS_NOT_ALLOWED"],
    ["https://[::]/", "ADDRESS_NOT_ALLOWED"],
    ["https://[::ffff:127.0.0.1]/", "ADDRESS_NOT_ALLOWED"],
    ["https://[::ffff:a9fe:a9fe]/", "ADDRESS_NOT_ALLOWED"], // mapped 169.254.169.254
    ["https://[64:ff9b::a00:1]/", "ADDRESS_NOT_ALLOWED"], // NAT64 10.0.0.1
    ["https://[2002:7f00:1::]/", "ADDRESS_NOT_ALLOWED"], // 6to4 127.0.0.1
    ["https://[fd00:ec2::254]/", "ADDRESS_NOT_ALLOWED"], // ULA / AWS metadata v6
    ["https://[fe80::1]/", "ADDRESS_NOT_ALLOWED"],
    ["https://[ff02::1]/", "ADDRESS_NOT_ALLOWED"],
    ["https://user:pass@example.com/", "CREDENTIALS_NOT_ALLOWED"],
    ["https://example.com:8443/", "PORT_NOT_ALLOWED"],
    ["not a url", "INVALID_URL"],
  ])("%s → %s", (url, expected) => {
    let got = "OK";
    try {
      validateUrlSyntax(url);
    } catch (e) {
      got = (e as SafeFetchError).code;
    }
    expect(got).toBe(expected);
  });

  it("public addresses pass; documentation / reserved ranges don't", () => {
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ["192.0.2.1", "198.51.100.7", "203.0.113.9", "198.18.0.1", "240.0.0.1", "255.255.255.255", "2001:db8::1", "fc00::1", "not-an-ip"]) expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("DNS answers: any private answer refuses the host (no 'first public wins'); DNS failure is reported", async () => {
    const t = transport({});
    expect(await code(safeFetch("https://evil.example.com/", { resolve: resolver({ "evil.example.com": ["10.0.0.7"] }), transport: t }))).toBe("ADDRESS_NOT_ALLOWED");
    expect(await code(safeFetch("https://mixed.example.com/", { resolve: resolver({ "mixed.example.com": ["93.184.216.34", "127.0.0.1"] }), transport: t }))).toBe("ADDRESS_NOT_ALLOWED");
    expect(await code(safeFetch("https://v6.example.com/", { resolve: resolver({ "v6.example.com": ["::1"] }), transport: t }))).toBe("ADDRESS_NOT_ALLOWED");
    const failing: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await code(safeFetch("https://nx.example.com/", { resolve: failing, transport: t }))).toBe("DNS_FAILED");
  });
});

describe("safe fetch: redirects, pinning, limits (tests 21, 23)", () => {
  it("connects only to the validated address (pinned), once per hop", async () => {
    const calls: Call[] = [];
    const r = await safeFetch("https://src.example.com/a", {
      resolve: resolver({ "src.example.com": ["93.184.216.34"] }),
      transport: transport({ "https://src.example.com/a": () => resp(200, { "content-type": "text/plain" }, chunks("hello")) }, calls),
    });
    expect(r.text).toBe("hello");
    expect(calls).toEqual([{ url: "https://src.example.com/a", pinned: "93.184.216.34" }]);
  });

  it("23. every redirect hop is re-validated: http, metadata IP, private DNS, credentials → refused; relative ok", async () => {
    const res = (loc: string) => () => resp(302, { location: loc });
    const base = { resolve: resolver({ "rebind.example.com": ["10.1.2.3"] }) };
    expect(await code(safeFetch("https://a.example.com/", { ...base, transport: transport({ "https://a.example.com/": res("http://a.example.com/plain") }) }))).toBe("SCHEME_NOT_ALLOWED");
    expect(await code(safeFetch("https://a.example.com/", { ...base, transport: transport({ "https://a.example.com/": res("https://169.254.169.254/latest/meta-data/") }) }))).toBe("ADDRESS_NOT_ALLOWED");
    expect(await code(safeFetch("https://a.example.com/", { ...base, transport: transport({ "https://a.example.com/": res("https://rebind.example.com/") }) }))).toBe("ADDRESS_NOT_ALLOWED");
    expect(await code(safeFetch("https://a.example.com/", { ...base, transport: transport({ "https://a.example.com/": res("https://u:p@b.example.com/") }) }))).toBe("CREDENTIALS_NOT_ALLOWED");
    expect(await code(safeFetch("https://a.example.com/", { ...base, transport: transport({ "https://a.example.com/": () => resp(301, {}) }) }))).toBe("BAD_REDIRECT");
    const ok = await safeFetch("https://a.example.com/x/start", {
      ...base,
      transport: transport({
        "https://a.example.com/x/start": res("../final?q=1#frag"),
        "https://a.example.com/final?q=1": () => resp(200, { "content-type": "text/plain; charset=utf-8" }, chunks("done")),
      }),
    });
    expect(ok.url).toBe("https://a.example.com/final?q=1");
    expect(ok.redirects).toEqual(["https://a.example.com/final?q=1"]);
  });

  it("at most 3 redirects", async () => {
    const hop = (n: number) => () => resp(302, { location: `https://a.example.com/${n + 1}` });
    const routes = { "https://a.example.com/0": hop(0), "https://a.example.com/1": hop(1), "https://a.example.com/2": hop(2), "https://a.example.com/3": hop(3) };
    expect(await code(safeFetch("https://a.example.com/0", { resolve: resolver(), transport: transport(routes) }))).toBe("TOO_MANY_REDIRECTS");
    const three = { ...routes, "https://a.example.com/3": () => resp(200, { "content-type": "text/plain" }, chunks("ok")) };
    expect((await safeFetch("https://a.example.com/0", { resolve: resolver(), transport: transport(three) })).redirects).toHaveLength(3);
  });

  it("21. retrieval timeout: no response, or a body that stalls, ends with TIMEOUT", async () => {
    const never: Transport = () => new Promise(() => undefined);
    expect(await code(safeFetch("https://slow.example.com/", { resolve: resolver(), transport: never, timeoutMs: 40 }))).toBe("TIMEOUT");
    async function* stall() {
      yield new TextEncoder().encode("partial");
      await new Promise(() => undefined);
    }
    const stalled = transport({ "https://slow.example.com/": () => resp(200, { "content-type": "text/plain" }, stall()) });
    expect(await code(safeFetch("https://slow.example.com/", { resolve: resolver(), transport: stalled, timeoutMs: 40 }))).toBe("TIMEOUT");
    const slowDns: Resolver = () => new Promise(() => undefined);
    expect(await code(safeFetch("https://slow.example.com/", { resolve: slowDns, transport: stalled, timeoutMs: 40 }))).toBe("TIMEOUT");
  });

  it("byte cap (also after decompression) truncates instead of buffering everything", async () => {
    const big = "x".repeat(300_000);
    const t = transport({ "https://big.example.com/": () => resp(200, { "content-type": "text/plain" }, chunks(big, big, big, big)) });
    const r = await safeFetch("https://big.example.com/", { resolve: resolver(), transport: t, maxBytes: 500_000 });
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(500_000);
    const bomb = gzipSync(Buffer.alloc(5_000_000, 0x61));
    const g = transport({ "https://gz.example.com/": () => resp(200, { "content-type": "text/plain", "content-encoding": "gzip" }, chunks(bomb)) });
    const z = await safeFetch("https://gz.example.com/", { resolve: resolver(), transport: g, maxBytes: 100_000 });
    expect(z.truncated).toBe(true);
    expect(z.text.length).toBe(100_000);
  });

  it("content-type allowlist; HTTP errors reported; HTML reduced to inert text", async () => {
    const t = transport({
      "https://img.example.com/": () => resp(200, { "content-type": "image/png" }, chunks("\x89PNG")),
      "https://none.example.com/": () => resp(200, {}, chunks("?")),
      "https://err.example.com/": () => resp(500, { "content-type": "text/plain" }),
      "https://page.example.com/": () =>
        resp(
          200,
          { "content-type": "text/html; charset=utf-8" },
          chunks(`<html><head><title>FPL &amp; GW6</title><script>steal()</script><style>p{}</style></head><body><nav>menu</nav><p>Haaland scored <b>2</b> goals.</p><img src=x onerror=alert(1)><iframe src="https://evil"></iframe><!-- hidden --><p>Bonus &#x3D; 3</p></body></html>`),
        ),
    });
    expect(await code(safeFetch("https://img.example.com/", { resolve: resolver(), transport: t }))).toBe("CONTENT_TYPE_NOT_ALLOWED");
    expect(await code(safeFetch("https://none.example.com/", { resolve: resolver(), transport: t }))).toBe("CONTENT_TYPE_NOT_ALLOWED");
    expect(await code(safeFetch("https://err.example.com/", { resolve: resolver(), transport: t }))).toBe("HTTP_ERROR");
    const page = await safeFetch("https://page.example.com/", { resolve: resolver(), transport: t });
    expect(page.title).toBe("FPL & GW6");
    expect(page.text).toBe("Haaland scored 2 goals.\nBonus = 3");
    expect(page.text).not.toMatch(/steal|menu|onerror|hidden|evil/);
    expect(htmlToText("<p>a</p><scr<script>ipt>x()</script>").text).not.toContain("<");
  });
});
