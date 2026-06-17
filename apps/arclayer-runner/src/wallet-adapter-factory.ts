/**
 * Wallet adapter factory.
 * Creates the correct WalletExecutionAdapter based on config.walletRail.
 *
 * - "circle-cli" (default): CircleCliAdapter (shell bridge to Circle CLI)
 * - "circle-dev": CircleDevWalletAdapter (Circle Developer-Controlled Wallet API)
 */
import { RunnerError } from "@arclayer/runner-core";
import type { RunnerConfig } from "@arclayer/runner-core";
import type { WalletExecutionAdapter } from "@arclayer/runner-core";
import { CircleCliAdapter } from "@arclayer/circle-cli-adapter";
import { CircleDevWalletAdapter } from "@arclayer/circle-dev-wallet-adapter";

export function createWalletAdapter(config: RunnerConfig): WalletExecutionAdapter {
  if (config.walletRail === "circle-dev") {
    // Validate required env for circle-dev rail
    const missing: string[] = [];
    if (!config.circleApiKey) missing.push("CIRCLE_API_KEY (circleApiKey)");
    if (!config.circleEntitySecret) missing.push("CIRCLE_ENTITY_SECRET (circleEntitySecret)");
    if (!config.circleWalletId) missing.push("CIRCLE_WALLET_ID (circleWalletId)");
    if (!config.circleWalletAddress) missing.push("CIRCLE_WALLET_ADDRESS (circleWalletAddress)");

    if (missing.length > 0) {
      throw new RunnerError(
        "CONFIG_ERROR",
        `circle-dev wallet rail requires: ${missing.join(", ")}`,
        500,
      );
    }

    return new CircleDevWalletAdapter({
      apiKey: config.circleApiKey!,
      entitySecret: config.circleEntitySecret!,
      walletId: config.circleWalletId!,
      walletSetId: config.circleWalletSetId,
      walletAddress: config.circleWalletAddress!,
      chain: config.chain,
      baseUrl: config.circleApiBaseUrl,
    });
  }

  // Default: circle-cli
  return new CircleCliAdapter({ bin: config.circleCliBin });
}
