/**
 * Wallet adapter factory.
 * Creates a CircleDevWalletAdapter from config.
 * Circle CLI has been removed — circle-dev is the only rail.
 */
import { RunnerError } from "@arclayer/runner-core";
import type { RunnerConfig, WalletExecutionAdapter } from "@arclayer/runner-core";
import { CircleDevWalletAdapter } from "@arclayer/circle-dev-wallet-adapter";

export function createWalletAdapter(config: RunnerConfig): WalletExecutionAdapter {
  const walletRail = config.walletRail ?? "circle-dev";

  if (walletRail !== "circle-dev") {
    throw new RunnerError(
      "CONFIG_ERROR",
      `Unsupported wallet rail "${walletRail}". Circle CLI has been removed from the Runner execution path; use ARCLAYER_WALLET_RAIL=circle-dev.`,
      500,
    );
  }

  const missing: string[] = [];
  if (!config.circleApiKey) missing.push("CIRCLE_API_KEY");
  if (!config.circleEntitySecret) missing.push("CIRCLE_ENTITY_SECRET");
  if (!config.circleWalletId) missing.push("CIRCLE_WALLET_ID");
  if (!config.circleWalletAddress) missing.push("CIRCLE_WALLET_ADDRESS");

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
    accountType: config.circleWalletAccountType ?? "EOA",
  });
}
