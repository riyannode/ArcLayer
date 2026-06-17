/**
 * @arclayer/langchain-adapter — ArcLayerRunnerClient.
 *
 * HMAC-authenticated HTTP client for ArcLayer Runner.
 * All requests are signed. Secrets are never logged or exposed.
 */

import { signRequest } from "./hmac.js";
import {
  ArcLayerRunnerAuthError,
  ArcLayerRunnerTimeoutError,
  ArcLayerRunnerProtocolError,
  ArcLayerError,
} from "./errors.js";
import { sanitizeErrorMessage } from "./redaction.js";
import type {
  ArcLayerRunnerClientOptions,
  X402InspectInput,
  X402PayInput,
  X402BatchPayInput,
  ProviderRunOnlyInput,
  ProviderRunAndSubmitInput,
  ProviderRunOnlyOutput,
  ProviderRunAndSubmitOutput,
} from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip trailing slashes without regex backtracking risk.
 * Avoids CodeQL alert on /\/+$/ pattern.
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}

/**
 * Extract a human-readable error message from a Runner ok:false response.
 */
function extractRunnerErrorMessage(result: Record<string, unknown>): string {
  const message =
    result.error ?? result.message ?? result.reason ?? "Unknown runner error";
  return typeof message === "string" ? message : String(message);
}

/**
 * Extract an error code from a Runner ok:false response.
 */
function extractRunnerErrorCode(result: Record<string, unknown>): string {
  const code = result.code ?? result.errorCode ?? "RUNNER_ERROR";
  return typeof code === "string" ? code : String(code);
}

// ── Client ──────────────────────────────────────────────────────────────────

export class ArcLayerRunnerClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: ArcLayerRunnerClientOptions) {
    if (!options.runnerUrl) {
      throw new ArcLayerError("INVALID_CONFIG", "runnerUrl is required");
    }
    if (!options.runnerSecret) {
      throw new ArcLayerError("INVALID_CONFIG", "runnerSecret is required");
    }

    // Normalize trailing slash without regex backtracking risk.
    this.baseUrl = stripTrailingSlashes(options.runnerUrl);

    // Validate URL scheme
    if (
      !this.baseUrl.startsWith("http://") &&
      !this.baseUrl.startsWith("https://")
    ) {
      throw new ArcLayerError(
        "INVALID_CONFIG",
        "runnerUrl must start with http:// or https://",
      );
    }

    this.secret = options.runnerSecret;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.userAgent =
      options.userAgent ?? "@arclayer/langchain-adapter/0.1.0";
  }

  // ── Core HTTP ───────────────────────────────────────────────────────────

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const bodyStr =
      body !== undefined ? JSON.stringify(body) : "";
    const url = `${this.baseUrl}${path}`;

    const headers = signRequest(
      this.secret,
      method,
      path,
      bodyStr,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          ...headers,
          "user-agent": this.userAgent,
        },
        body: bodyStr || undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Parse response first so Runner policy errors on 403 are preserved.
      // Runner commonly returns ok:false JSON for payment-policy denials.
      let data: unknown;
      let hasJsonBody = false;
      try {
        data = await response.json();
        hasJsonBody = true;
      } catch {
        data = undefined;
      }

      // Runner ok:false pattern. Preserve policy/actionable errors even on 403.
      if (hasJsonBody && data && typeof data === "object") {
        const result = data as Record<string, unknown>;
        if (result.ok === false) {
          const code = extractRunnerErrorCode(result);
          const msg = extractRunnerErrorMessage(result);
          throw new ArcLayerError(code, msg, response.status);
        }
      }

      // Actual auth failures without actionable Runner JSON.
      if (response.status === 401) {
        throw new ArcLayerRunnerAuthError(
          `Runner auth failed (${response.status})`,
        );
      }
      if (response.status === 403) {
        throw new ArcLayerError(
          "RUNNER_FORBIDDEN",
          "Runner rejected the request with 403",
          403,
        );
      }

      // Other non-2xx responses.
      if (!response.ok) {
        throw new ArcLayerRunnerProtocolError(
          `Runner returned HTTP ${response.status}`,
        );
      }

      if (!hasJsonBody) {
        throw new ArcLayerRunnerProtocolError(
          `Runner returned non-JSON response (status ${response.status})`,
        );
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof ArcLayerError) {
        throw error;
      }

      // Abort = timeout
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        throw new ArcLayerRunnerTimeoutError(this.timeoutMs);
      }

      // Network errors
      const msg = sanitizeErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      throw new ArcLayerRunnerProtocolError(`Runner request failed: ${msg}`);
    }
  }

  // ── Typed Methods ─────────────────────────────────────────────────────

  /**
   * Inspect an x402-protected resource (read-only, no payment).
   * Note: injects PaymentRequestSchema-compatible fields internally.
   */
  async inspectX402(input: X402InspectInput): Promise<unknown> {
    return this.post("/x402/inspect", {
      type: "x402_service_pay",
      url: input.url,
      method: input.method ?? "GET",
      body: input.body,
      maxAmountUsdc: "0",
      reason: "inspect",
    });
  }

  /**
   * Pay an x402-protected resource through Runner.
   */
  async payX402(input: X402PayInput): Promise<unknown> {
    return this.post("/x402/pay", {
      type: "x402_service_pay",
      url: input.url,
      method: input.method ?? "GET",
      maxAmountUsdc: input.maxAmountUsdc,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      body: input.body,
    });
  }

  /**
   * Batch pay multiple x402-protected resources.
   */
  async batchPayX402(input: X402BatchPayInput): Promise<unknown> {
    return this.post("/x402/batch-pay", {
      batchId: input.batchId,
      taskId: input.taskId,
      payments: input.payments.map((p) => ({
        type: "x402_service_pay",
        url: p.url,
        method: p.method ?? "GET",
        maxAmountUsdc: p.maxAmountUsdc,
        reason: p.reason,
        idempotencyKey: p.idempotencyKey,
        body: p.body,
      })),
    });
  }

  /**
   * List recent receipts.
   */
  async listReceipts(limit = 50): Promise<unknown> {
    return this.get(`/receipts?limit=${limit}`);
  }

  /**
   * List recent spending ledger records.
   */
  async listLedger(limit = 50): Promise<unknown> {
    return this.get(`/ledger?limit=${limit}`);
  }

  // ── Provider Runtime ──────────────────────────────────────────────────

  /**
   * Run an ERC-8183 provider job (runtime only, no on-chain submit).
   * Calls POST /erc8183/provider/run-only.
   */
  async runProviderJobOnly(
    input: ProviderRunOnlyInput,
  ): Promise<ProviderRunOnlyOutput> {
    return this.post<ProviderRunOnlyOutput>(
      "/erc8183/provider/run-only",
      input,
    );
  }

  /**
   * Run an ERC-8183 provider job and submit deliverable on-chain.
   * Calls POST /erc8183/provider/run-and-submit.
   */
  async runAndSubmitProviderJob(
    input: ProviderRunAndSubmitInput,
  ): Promise<ProviderRunAndSubmitOutput> {
    return this.post<ProviderRunAndSubmitOutput>(
      "/erc8183/provider/run-and-submit",
      input,
    );
  }
}
