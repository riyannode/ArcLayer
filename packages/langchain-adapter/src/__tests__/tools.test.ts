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
  const ok = response.ok ?? (status >= 200 && status < 300);
  return vi.fn().mockResolvedValue({
    status,
    ok,
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
      const fetch = vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        json: () => Promise.reject(new Error("not json")),
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/protected")).rejects.toThrow(
        ArcLayerRunnerAuthError,
      );
    });

    it("throws ArcLayerError on 403 without JSON", async () => {
      const fetch = vi.fn().mockResolvedValue({
        status: 403,
        ok: false,
        json: () => Promise.reject(new Error("not json")),
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/protected")).rejects.toThrow(
        "Runner rejected the request with 403",
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

  describe("runProviderJobOnly", () => {
    it("POSTs to /erc8183/provider/run-only with correct body", async () => {
      const fetch = mockFetch({
        body: {
          ok: true,
          status: "completed",
          role: "provider",
          result: { output: "hello" },
          deliverableHash: "0xabc123",
          runId: "run-1",
          receipt: {},
        },
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      const input = {
        taskId: "task-1",
        jobId: "123",
        agentId: "agent-1",
        provider: "0x1234567890abcdef1234567890abcdef12345678",
        description: "test job",
        input: { prompt: "hello" },
      };

      const result = await client.runProviderJobOnly(input);
      expect(result).toEqual({
        ok: true,
        status: "completed",
        role: "provider",
        result: { output: "hello" },
        deliverableHash: "0xabc123",
        runId: "run-1",
        receipt: {},
      });

      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe(
        "http://127.0.0.1:8787/erc8183/provider/run-only",
      );
      expect(opts.method).toBe("POST");
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.taskId).toBe("task-1");
      expect(sentBody.jobId).toBe("123");
      expect(sentBody.provider).toBe(
        "0x1234567890abcdef1234567890abcdef12345678",
      );
    });

    it("sends HMAC headers", async () => {
      const fetch = mockFetch({ body: { ok: true } });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await client.runProviderJobOnly({
        taskId: "t",
        jobId: "1",
        agentId: "a",
        provider: "0x1234567890abcdef1234567890abcdef12345678",
        description: "d",
        input: {},
      });

      const [, opts] = fetch.mock.calls[0];
      expect(opts.headers["x-arclayer-runner-timestamp"]).toBeDefined();
      expect(opts.headers["x-arclayer-runner-nonce"]).toBeDefined();
      expect(opts.headers["x-arclayer-runner-signature"]).toMatch(
        /^sha256=[a-f0-9]{64}$/,
      );
    });
  });

  describe("runAndSubmitProviderJob", () => {
    it("POSTs to /erc8183/provider/run-and-submit", async () => {
      const fetch = mockFetch({
        body: {
          ok: true,
          status: "completed",
          role: "provider",
          result: {},
          deliverableHash: "0xdef",
          runId: "run-2",
          submitReceipt: { txHash: "0x123" },
          receipt: {},
        },
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      const result = await client.runAndSubmitProviderJob({
        taskId: "task-2",
        jobId: "456",
        agentId: "agent-2",
        provider: "0x1234567890abcdef1234567890abcdef12345678",
        description: "submit job",
        input: { data: "test" },
      });

      const [url] = fetch.mock.calls[0];
      expect(url).toBe(
        "http://127.0.0.1:8787/erc8183/provider/run-and-submit",
      );
      expect(result).toHaveProperty("submitReceipt");
    });
  });

  describe("stripTrailingSlashes", () => {
    it("normalizes runnerUrl with many trailing slashes without regex", async () => {
      const slashyUrl = "http://127.0.0.1:8787" + "/".repeat(10_000);
      const calls: string[] = [];
      const client = new ArcLayerRunnerClient({
        runnerUrl: slashyUrl,
        runnerSecret: "secret",
        fetchImpl: async (url) => {
          calls.push(String(url));
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      await client.listReceipts(1);
      expect(calls[0]).toBe("http://127.0.0.1:8787/receipts?limit=1");
    });
  });

  describe("403 policy error preservation", () => {
    it("preserves Runner ok:false on 403 as ArcLayerError, not auth error", async () => {
      const fetch = vi.fn().mockResolvedValue({
        status: 403,
        json: () =>
          Promise.resolve({
            ok: false,
            code: "PAYMENT_DENIED",
            error: "Daily limit exceeded",
          }),
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/x402/pay")).rejects.toThrow("Daily limit exceeded");
      try {
        await client.get("/x402/pay");
      } catch (e: unknown) {
        // Should be ArcLayerError with code PAYMENT_DENIED, not ArcLayerRunnerAuthError
        expect((e as { code: string }).code).toBe("PAYMENT_DENIED");
      }
    });

    it("returns RUNNER_FORBIDDEN for 403 without JSON body", async () => {
      const fetch = vi.fn().mockResolvedValue({
        status: 403,
        json: () => Promise.reject(new Error("not json")),
      });
      const client = new ArcLayerRunnerClient({
        ...defaultOpts,
        fetchImpl: fetch,
      });

      await expect(client.get("/protected")).rejects.toThrow(
        "Runner rejected the request with 403",
      );
    });
  });
});

describe("createArcLayerLangChainTools", () => {
  it("allows host with non-default port when allowedHosts includes port", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "x402-agent",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      allowedHosts: ["api.example.com:8443"],
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const inspect = tools.find((t) => t.name === "x402_inspect");
    expect(inspect).toBeDefined();

    const result = await inspect!.invoke({
      url: "https://api.example.com:8443/protected",
      method: "GET",
    });
    expect(result).not.toContain("Error:");
    expect(calls.length).toBe(1);
  });

  it("rejects duplicate batch idempotency keys", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "x402-agent",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      maxAmountUsdc: "0.01",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const batch = tools.find((t) => t.name === "x402_batch_pay");
    expect(batch).toBeDefined();

    const result = await batch!.invoke({
      batchId: "batch-1",
      taskId: "task-1",
      payments: [
        {
          url: "https://api.example.com/a",
          method: "GET",
          maxAmountUsdc: "0.001",
          reason: "pay a",
          idempotencyKey: "same-key",
        },
        {
          url: "https://api.example.com/b",
          method: "GET",
          maxAmountUsdc: "0.001",
          reason: "pay b",
          idempotencyKey: "same-key",
        },
      ],
    });
    expect(result).toContain("Duplicate idempotencyKey");
  });

  it("provider_run_only calls /erc8183/provider/run-only", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            ok: true,
            status: "completed",
            role: "provider",
            result: { output: "done" },
            deliverableHash: "0xabc",
            runId: "run-1",
            receipt: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const runOnly = tools.find(
      (t) => t.name === "erc8183_provider_run_only",
    );
    expect(runOnly).toBeDefined();

    const result = await runOnly!.invoke({
      taskId: "task-1",
      jobId: "100",
      agentId: "agent-1",
      provider: "0x1234567890abcdef1234567890abcdef12345678",
      description: "test job",
      input: { prompt: "hello" },
    });

    expect(result).not.toContain("Error:");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain("/erc8183/provider/run-only");
  });

  it("provider_run_only sends evaluator? and metadata? in body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({ ok: true, status: "completed", role: "provider", result: {}, deliverableHash: "0x0", runId: "r", receipt: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const runOnly = tools.find(
      (t) => t.name === "erc8183_provider_run_only",
    );

    await runOnly!.invoke({
      taskId: "task-1",
      jobId: "100",
      agentId: "agent-1",
      provider: "0x1234567890abcdef1234567890abcdef12345678",
      evaluator: "0xabcdef1234567890abcdef1234567890abcdef12",
      description: "test with evaluator and metadata",
      input: { prompt: "hello" },
      metadata: { source: "test", priority: 1 },
    });

    const sentBody = JSON.parse(calls[0].init!.body as string);
    expect(sentBody.evaluator).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
    expect(sentBody.metadata).toEqual({ source: "test", priority: 1 });
  });

  it("provider_run_and_submit calls /erc8183/provider/run-and-submit", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderRunAndSubmit: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            ok: true,
            status: "completed",
            role: "provider",
            result: {},
            deliverableHash: "0xdef",
            runId: "run-2",
            submitReceipt: { txHash: "0x123" },
            receipt: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const runAndSubmit = tools.find(
      (t) => t.name === "erc8183_provider_run_and_submit",
    );
    expect(runAndSubmit).toBeDefined();

    const result = await runAndSubmit!.invoke({
      taskId: "task-2",
      jobId: "200",
      agentId: "agent-2",
      provider: "0x1234567890abcdef1234567890abcdef12345678",
      description: "submit job",
      input: { data: "test" },
    });

    expect(result).not.toContain("Error:");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain(
      "/erc8183/provider/run-and-submit",
    );
  });

  it("provider tools errors are redacted", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () => {
        throw new Error(
          "Runner auth failed with Bearer abc123secrettoken",
        );
      },
    });

    const runOnly = tools.find(
      (t) => t.name === "erc8183_provider_run_only",
    );
    expect(runOnly).toBeDefined();

    const result = await runOnly!.invoke({
      taskId: "task-1",
      jobId: "1",
      agentId: "a",
      provider: "0x1234567890abcdef1234567890abcdef12345678",
      description: "d",
      input: {},
    });

    expect(result).toContain("Error:");
    expect(result).not.toContain("abc123secrettoken");
  });

  it("read-only role does not include provider tools", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "read-only",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("erc8183_provider_run_only");
    expect(toolNames).not.toContain("erc8183_provider_run_and_submit");
  });

  it("x402-agent role does not include provider tools", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "x402-agent",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("erc8183_provider_run_only");
    expect(toolNames).not.toContain("erc8183_provider_run_and_submit");
  });

  it("provider role does not expose run-and-submit by default", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("erc8183_provider_run_only");
    expect(toolNames).not.toContain("erc8183_provider_run_and_submit");
  });

  it("provider role exposes run-and-submit only with explicit opt-in", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderRunAndSubmit: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("erc8183_provider_run_only");
    expect(toolNames).toContain("erc8183_provider_run_and_submit");
  });

  // ── Provider Pricing Tools ──────────────────────────────────────────────

  it("provider default includes quote_job but not set_budget", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("erc8183_provider_quote_job");
    expect(toolNames).not.toContain("erc8183_provider_set_budget");
  });

  it("provider with enableProviderSetBudget=true includes set_budget", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("erc8183_provider_quote_job");
    expect(toolNames).toContain("erc8183_provider_set_budget");
  });

  it("quote_job is adapter-only and does not call fetch/Runner", async () => {
    const fetchCalls: string[] = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async (url) => {
        fetchCalls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const quote = tools.find((t) => t.name === "erc8183_provider_quote_job");
    expect(quote).toBeDefined();

    const result = await quote!.invoke({
      jobId: "100",
      description: "A simple task",
      input: { prompt: "hello" },
    });

    expect(result).not.toContain("Error:");
    expect(fetchCalls.length).toBe(0); // No Runner call
  });

  it("quote_job maps low complexity to 1.00", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const quote = tools.find((t) => t.name === "erc8183_provider_quote_job")!;

    const result = await quote.invoke({
      jobId: "100",
      description: "simple task",
      input: {},
      complexityHint: "low",
    });

    const parsed = JSON.parse(result as string);
    expect(parsed.complexity).toBe("low");
    expect(parsed.suggestedBudgetUsdc).toBe("1.00");
  });

  it("quote_job maps medium complexity to 3.00", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const quote = tools.find((t) => t.name === "erc8183_provider_quote_job")!;

    const result = await quote.invoke({
      jobId: "100",
      description: "medium task",
      input: {},
      complexityHint: "medium",
    });

    const parsed = JSON.parse(result as string);
    expect(parsed.complexity).toBe("medium");
    expect(parsed.suggestedBudgetUsdc).toBe("3.00");
  });

  it("quote_job maps high complexity to 5.00", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const quote = tools.find((t) => t.name === "erc8183_provider_quote_job")!;

    const result = await quote.invoke({
      jobId: "100",
      description: "complex task",
      input: {},
      complexityHint: "high",
    });

    const parsed = JSON.parse(result as string);
    expect(parsed.complexity).toBe("high");
    expect(parsed.suggestedBudgetUsdc).toBe("5.00");
  });

  it("set_budget requires reason", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    // Zod validation throws on empty reason before tool callback runs
    await expect(
      setBudget.invoke({
        jobId: "100",
        amount: "3.00",
        complexity: "medium",
        reason: "",
      }),
    ).rejects.toThrow();
  });

  it("set_budget requires complexity", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    // Missing complexity — Zod throws
    await expect(
      setBudget.invoke({
        jobId: "100",
        amount: "3.00",
        reason: "test reason",
      }),
    ).rejects.toThrow();
  });

  it("set_budget rejects reason over 512 chars", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    const longReason = "x".repeat(513);
    await expect(
      setBudget.invoke({
        jobId: "100",
        amount: "3.00",
        complexity: "medium",
        reason: longReason,
      }),
    ).rejects.toThrow();
  });

  it("set_budget rejects 5.01", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    const result = await setBudget.invoke({
      jobId: "100",
      amount: "5.01",
      complexity: "high",
      reason: "test reason",
    });

    expect(result).toContain("Error:");
    expect(result).toContain("5");
  });

  it("set_budget accepts 5.00", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({ ok: true, txHash: "0xabc", receipt: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    const result = await setBudget.invoke({
      jobId: "100",
      amount: "5.00",
      complexity: "high",
      reason: "High complexity job requiring full budget",
    });

    expect(result).not.toContain("Error:");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain("/erc8183/provider/set-budget");
  });

  it("set_budget rejects amount 0", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    const result = await setBudget.invoke({
      jobId: "100",
      amount: "0",
      complexity: "low",
      reason: "test",
    });

    expect(result).toContain("Error:");
  });

  it("set_budget sends HMAC headers", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({ ok: true, txHash: "0xabc", receipt: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    await setBudget.invoke({
      jobId: "100",
      amount: "3.00",
      complexity: "medium",
      reason: "Medium complexity job",
    });

    expect(calls.length).toBe(1);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-arclayer-runner-timestamp"]).toBeDefined();
    expect(headers["x-arclayer-runner-nonce"]).toBeDefined();
    expect(headers["x-arclayer-runner-signature"]).toMatch(
      /^sha256=[a-f0-9]{64}$/,
    );
  });

  it("set_budget sends reason and complexity to Runner", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({ ok: true, txHash: "0xabc", receipt: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    await setBudget.invoke({
      jobId: "200",
      amount: "3.00",
      complexity: "medium",
      reason: "Multi-step reasoning required",
    });

    const sentBody = JSON.parse(calls[0].init!.body as string);
    expect(sentBody.jobId).toBe("200");
    expect(sentBody.amount).toBe("3.00");
    expect(sentBody.complexity).toBe("medium");
    expect(sentBody.reason).toBe("Multi-step reasoning required");
  });

  it("set_budget errors are sanitized", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () => {
        throw new Error(
          "Runner auth failed with Bearer secretToken123abc",
        );
      },
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    const result = await setBudget.invoke({
      jobId: "100",
      amount: "3.00",
      complexity: "medium",
      reason: "test reason",
    });

    expect(result).toContain("Error:");
    expect(result).not.toContain("secretToken123abc");
  });

  it("quote clamps to custom maxBudgetUsdc when tier budget exceeds it", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      providerPricingPolicy: {
        maxBudgetUsdc: "2.00",
        lowComplexityBudgetUsdc: "1.00",
        mediumComplexityBudgetUsdc: "3.00",
        highComplexityBudgetUsdc: "5.00",
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const quote = tools.find((t) => t.name === "erc8183_provider_quote_job")!;

    const result = await quote.invoke({
      jobId: "100",
      description: "complex task",
      input: { data: "test" },
      complexityHint: "high",
    });

    const parsed = JSON.parse(result as string);
    expect(parsed.complexity).toBe("high");
    expect(parsed.suggestedBudgetUsdc).toBe("2.00"); // clamped from 5.00 to 2.00
  });

  it("quote_job rejects missing input (undefined)", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const quote = tools.find((t) => t.name === "erc8183_provider_quote_job")!;

    await expect(
      quote.invoke({
        jobId: "100",
        description: "task",
      }),
    ).rejects.toThrow();
  });

  it("set_budget rejects sub-micro amount 0.0000009", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    // 0.0000009 has 7 fractional digits — exceeds 6 digit limit
    await expect(
      setBudget.invoke({
        jobId: "100",
        amount: "0.0000009",
        complexity: "low",
        reason: "test",
      }),
    ).rejects.toThrow();
  });

  it("set_budget rejects more than 6 fractional digits", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    const tools = createArcLayerLangChainTools({
      role: "provider",
      enableProviderSetBudget: true,
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const setBudget = tools.find(
      (t) => t.name === "erc8183_provider_set_budget",
    )!;

    // 1.1234567 has 7 fractional digits
    await expect(
      setBudget.invoke({
        jobId: "100",
        amount: "1.1234567",
        complexity: "low",
        reason: "test",
      }),
    ).rejects.toThrow();
  });

  it("non-provider roles cannot access quote_job or set_budget", async () => {
    const { createArcLayerLangChainTools } = await import("../tools.js");

    for (const role of ["read-only", "x402-agent", "evaluator", "client"] as const) {
      const tools = createArcLayerLangChainTools({
        role,
        runnerUrl: "http://127.0.0.1:8787",
        runnerSecret: "secret",
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).not.toContain("erc8183_provider_quote_job");
      expect(toolNames).not.toContain("erc8183_provider_set_budget");
    }
  });
});
