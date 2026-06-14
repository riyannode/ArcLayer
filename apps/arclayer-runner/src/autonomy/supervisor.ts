/**
 * Supervisor — manages autonomy worker lifecycle.
 *
 * Starts/stops workers based on role, handles SIGINT/SIGTERM,
 * reports health status.
 */
import type { ProviderWorker } from "./provider-worker";
import type { EvaluatorWorker } from "./evaluator-worker";
import type { AutonomyStore } from "./autonomy-store";
import type { ArcChainReader } from "../chain-reader";
import type { ArcLayerMcpConnector } from "../mcp-connector";
import type { RunnerServices } from "../services";
import type { AutonomyRole, WorkerHealth } from "./types";

export type SupervisorConfig = {
  role: AutonomyRole;
  pollIntervalMs: number;
  leaseMs: number;
  maxConcurrentJobs: number;
  allowLegacyPlainTextJobs: boolean;
  completeThreshold: number;
  manualReviewThreshold: number;
};

export class Supervisor {
  private providerWorker: ProviderWorker | null = null;
  private evaluatorWorker: EvaluatorWorker | null = null;
  private running = false;

  constructor(
    private readonly services: RunnerServices,
    private readonly chainReader: ArcChainReader,
    private readonly store: AutonomyStore,
    private readonly mcp: ArcLayerMcpConnector,
    private readonly walletAddress: string,
    private readonly config: SupervisorConfig
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Register signal handlers
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());

    console.log(`[supervisor] Starting autonomy worker for role: ${this.config.role}`);

    switch (this.config.role) {
      case "provider": {
        const { ProviderWorker } = await import("./provider-worker");
        this.providerWorker = new ProviderWorker(
          this.services,
          this.chainReader,
          this.store,
          // Runtime will be injected by caller
          null as any,
          this.mcp,
          this.walletAddress,
          {
            pollIntervalMs: this.config.pollIntervalMs,
            leaseMs: this.config.leaseMs,
            maxConcurrentJobs: this.config.maxConcurrentJobs,
            allowLegacyPlainTextJobs: this.config.allowLegacyPlainTextJobs,
          }
        );
        await this.providerWorker.start();
        break;
      }
      case "evaluator": {
        const { EvaluatorWorker } = await import("./evaluator-worker");
        this.evaluatorWorker = new EvaluatorWorker(
          this.services,
          this.chainReader,
          this.store,
          null as any,
          this.mcp,
          this.walletAddress,
          {
            pollIntervalMs: this.config.pollIntervalMs,
            leaseMs: this.config.leaseMs,
            maxConcurrentJobs: this.config.maxConcurrentJobs,
            completeThreshold: this.config.completeThreshold,
            manualReviewThreshold: this.config.manualReviewThreshold,
          }
        );
        await this.evaluatorWorker.start();
        break;
      }
      case "client":
        console.log("[supervisor] Client role uses on-demand orchestration, not polling.");
        break;
      case "x402-agent":
        console.log("[supervisor] x402-agent role is handled by provider worker's x402 coordinator.");
        break;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.log("[supervisor] Stopping autonomy workers...");

    if (this.providerWorker) {
      await this.providerWorker.stop();
      this.providerWorker = null;
    }
    if (this.evaluatorWorker) {
      await this.evaluatorWorker.stop();
      this.evaluatorWorker = null;
    }

    this.store.close();
    console.log("[supervisor] All workers stopped.");
  }

  getHealth(): WorkerHealth {
    if (this.providerWorker) return this.providerWorker.getHealth();
    if (this.evaluatorWorker) return this.evaluatorWorker.getHealth();
    return {
      enabled: true,
      role: this.config.role,
      workerState: this.running ? "running" : "stopped",
      activeWorkflows: 0,
      lastPollAt: null,
      lastError: null,
    };
  }
}
