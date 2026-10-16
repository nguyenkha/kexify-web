import { describe, expect, test } from "bun:test";
import { buildClientHeader, isApiRequest, readUpdateRequired, subscribeUpdateRequired, withClientHeader } from "./client-version-gate";

const PAGE = "https://my.kexify.app";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("client version gate (web)", () => {
  test("header string", () => {
    expect(buildClientHeader("0.10.6", "1a2b3c4")).toBe("web/0.10.6 (build 1a2b3c4); mpc=2p:1");
    expect(buildClientHeader("0.10.6", "")).toBe("web/0.10.6 (build dev); mpc=2p:1");
  });

  test("isApiRequest: same-origin /api and a dedicated API origin only", () => {
    expect(isApiRequest("/api/keys", "", PAGE)).toBe(true);
    expect(isApiRequest("/apix", "", PAGE)).toBe(false);
    expect(isApiRequest("https://rpc.example/api/x", "", PAGE)).toBe(false);
    expect(isApiRequest("https://api-cf.kexify.co/keys", "https://api-cf.kexify.co", PAGE)).toBe(true);
    expect(isApiRequest("https://api.coingecko.com/api/v3", "https://api-cf.kexify.co", PAGE)).toBe(false);
  });

  test("readUpdateRequired only for the gate's 426 body", async () => {
    expect(await readUpdateRequired(json(426, { error: "update_required", platform: "web", minSupported: "0.11.0" })))
      .toEqual({ platform: "web", minSupported: "0.11.0", autoReload: true });
    expect(await readUpdateRequired(json(426, { error: "other" }))).toBeNull();
    expect(await readUpdateRequired(json(403, { error: "update_required" }))).toBeNull();
    expect(await readUpdateRequired(new Response("not json", { status: 426 }))).toBeNull();
  });

  test("wrapped fetch: adds the header to API calls only, and a 426 raises the update screen", async () => {
    const seen: Array<{ url: string; header: string | null }> = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push({ url, header: new Headers(init?.headers).get("X-Kexify-Client") });
      return url.endsWith("/old") ? json(426, { error: "update_required", platform: "web", minSupported: "0.11.0" }) : json(200, { ok: true });
    }) as typeof fetch;
    const f = withClientHeader(base, "web/0.10.6 (build x); mpc=2p:1", "", PAGE);

    const raised: unknown[] = [];
    const unsub = subscribeUpdateRequired((i) => raised.push(i));

    const ok = await f("/api/keys", { headers: { Authorization: "Bearer t" } });
    expect(await ok.json()).toEqual({ ok: true });
    await f("https://rpc.example/x");
    expect(seen[0]).toEqual({ url: "/api/keys", header: "web/0.10.6 (build x); mpc=2p:1" });
    expect(seen[1].header).toBeNull();
    expect(raised).toEqual([]);

    const res = await f("/api/old");
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ error: "update_required" }); // body still readable by the caller
    expect(raised).toEqual([{ platform: "web", minSupported: "0.11.0", autoReload: true }]);

    // A subscriber that mounts later still sees it.
    const late: unknown[] = [];
    subscribeUpdateRequired((i) => late.push(i))();
    expect(late).toHaveLength(1);
    unsub();
  });
});
