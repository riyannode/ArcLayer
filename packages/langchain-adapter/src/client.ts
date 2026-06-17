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
} from "./types.js";

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

    // Normalize trailing slash
    this.baseUrl = options.runnerUrl.replace(/\/+$/, "");

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

      // Auth failures
      if (response.status === 401 || response.status === 403) {
        throw new ArcLayerRunnerAuthError(
          `Runner auth failed (${response.status})`,
        );
      }

      // Parse response
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ArcLayerRunnerProtocolError(
          `Runner returned non-JSON response (status ${response.status})`,
        );
      }

      // Runner ok:false pattern
      const result = data as Record<string, unknown>;
      if (result && result.ok === false) {
        const code = (result.code as string) ?? "RUNNER_ERROR";
        const msg = (result.error as string) ?? "Unknown runner error";
        throw new ArcLayerError(code, msg, response.status);
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
}
