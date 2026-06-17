import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArcLayerRunnerClient } from "../client.js";
import {
  ArcLayerRunnerAuthError,
  ArcLayerRunnerTimeoutError,
  ArcLayerRunnerProtocolError,
} from "../errors.js";

// ── Mock fetch ──────────────────────────────────────────────────────────────

function mockFetch(response: {
  status?: number;
  body?: unknown;
  ok?: boolean;
}) {
  const status = response.status ?? 200;
  const body = response.body ?? { ok: true };
  return vi.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ArcLayerRunnerClient", () => {
  const defaultOpts = {
    runnerUrl: "http://127.0.0.1:8787",
    runnerSecret: "test-secret-key-32chars-long!!",
  };

  describe("constructor", () => {
    it("throws on missing runnerUrl", () => {
      expect(
        () =>
          new ArcLayerRunnerClient({
            ...defaultOpts,
            runnerUrl: "",
          }),
      ).toThrow("runnerUrl is required");
    });

    it("throws on missing runnerSecret", () => {
      expect(
        () =>
          new ArcLayerRunnerClient({
            ...defaultOpts,
            runnerSecret: "",
          }),
      ).toThrow("runnerSecret is required");
    });

    it("throws on non-http URL", () => {
      expect(
        () =>
          new ArcLayerRunnerClient({
            ...defaultOpts,
            runnerUrl: "ftp://example.com",
          }),
      ).toThrow("http:// or https://");
    });

    it("normalizes trailing slashes", () => {
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        runnerUrl: "http://127.0.0.1:8787///",
      });
      // Should not throw — URL normalized internally
      expect(client).toBeDefined();
    });
  });

  describe("get/post", () => {
    it("GET sends HMAC-signed request", async () => {
      const fetch = mockFetch({ body: { ok: true, data: "test" } });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      const result = await client.get("/health");
      expect(result).toEqual({ ok: true, data: "test" });
      expect(fetch).toHaveBeenCalledOnce();

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:8787/health");
      expect(opts.method).toBe("GET");
      expect(opts.headers["x-arclayer-runner-timestamp"]).toBeDefined();
      expect(opts.headers["x-arclayer-runner-nonce"]).toBeDefined();
      expect(opts.headers["x-arclayer-runner-signature"]).toMatch(
        /^sha256=[a-f0-9]{64}$/,
      );
    });

    it("POST sends body and HMAC signature", async () => {
      const fetch = mockFetch({ body: { ok: true } });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await client.post("/x402/inspect", { url: "https://example.com" });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:8787/x402/inspect");
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe(
        JSON.stringify({ url: "https://example.com" }),
      );
    });

    it("throws ArcLayerRunnerAuthError on 401", async () => {
      const fetch = mockFetch({ status: 401, body: { ok: false } });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/protected")).rejects.toThrow(
        ArcLayerRunnerAuthError,
      );
    });

    it("throws ArcLayerRunnerAuthError on 403", async () => {
      const fetch = mockFetch({ status: 403, body: { ok: false } });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/protected")).rejects.toThrow(
        ArcLayerRunnerAuthError,
      );
    });

    it("throws ArcLayerRunnerProtocolError on non-JSON response", async () => {
      const fetch = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.reject(new Error("not json")),
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/health")).rejects.toThrow(
        ArcLayerRunnerProtocolError,
      );
    });

    it("throws ArcLayerError on Runner ok:false", async () => {
      const fetch = mockFetch({
        body: { ok: false, code: "PAYMENT_DENIED", error: "Over limit" },
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/x402/pay")).rejects.toThrow("Over limit");
    });
  });

  describe("inspectX402", () => {
    it("injects PaymentRequestSchema-compatible fields", async () => {
      const fetch = mockFetch({ body: { ok: true, result: {} } });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await client.inspectX402({
        url: "https://example.com/api",
        method: "POST",
        body: { key: "value" },
      });

      const [, opts] = fetch.mock.calls[0];
      const sentBody = JSON.parse(opts.body);
      expect(sentBody).toEqual({
        type: "x402_service_pay",
        url: "https://example.com/api",
        method: "POST",
        body: { key: "value" },
        maxAmountUsdc: "0",
        reason: "inspect",
      });
    });
  });

  describe("payX402", () => {
    it("sends correct body shape", async () => {
      const fetch = mockFetch({ body: { ok: true, receipt: {} } });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await client.payX402({
        url: "https://example.com/api",
        maxAmountUsdc: "0.001",
        reason: "test payment",
      });

      const [, opts] = fetch.mock.calls[0];
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.type).toBe("x402_service_pay");
      expect(sentBody.maxAmountUsdc).toBe("0.001");
      expect(sentBody.reason).toBe("test payment");
    });
  });

  describe("listReceipts", () => {
    it("GETs /receipts with limit", async () => {
      const fetch = mockFetch({
        body: { ok: true, receipts: [{ id: "1" }] },
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      const result = await client.listReceipts(25);
      expect(result).toEqual({ ok: true, receipts: [{ id: "1" }] });

      const [url] = fetch.mock.calls[0];
      expect(url).toContain("/receipts?limit=25");
    });
  });

  describe("listLedger", () => {
    it("GETs /ledger with limit", async () => {
      const fetch = mockFetch({
        body: { ok: true, records: [] },
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await client.listLedger(10);
      const [url] = fetch.mock.calls[0];
      expect(url).toContain("/ledger?limit=10");
    });
  });
});
