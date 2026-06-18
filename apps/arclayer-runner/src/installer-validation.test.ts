/**
 * Installer and script validation tests.
 *
 * Verifies:
 *   - No CIRCLE_CLI_BIN references in active code
 *   - No packages/runner/dist/index.js references (uses pnpm workspace)
 *   - No ARCLAYER_AGENT_ID=agent- slug references
 *   - Installer PM2 service uses arclayer-provider
 *   - Installer does not accept private keys
 *   - Installer uses pnpm --filter for identity ensure
 *   - Installer builds SDK before runner
 *   - Installer builds Circle Dev Wallet adapter before runner
 *   - Live test script requires --live-arc-testnet
 *   - Live test script refuses mock job data
 *   - ARCLAYER_AGENT_ID is NOT written as slug
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = join(__dirname, "..", "..", "..");

function readRelative(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function grep(pattern: string, paths: string[]): string[] {
  try {
    const result = execSync(
      `grep -R "${pattern}" ${paths.join(" ")} --exclude-dir=node_modules --include="*.ts" --include="*.sh" --include="*.md" --exclude="*.test.ts" -l 2>/dev/null || true`,
      { cwd: ROOT, encoding: "utf8" },
    );
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("installer validation", () => {
  const searchPaths = [
    "scripts",
    "apps/arclayer-runner/src",
    "agents/examples",
    "packages/runner-core/src",
    "docs",
  ];

  it("has no active CIRCLE_CLI_BIN references", () => {
    const hits = grep("CIRCLE_CLI_BIN", searchPaths);
    expect(hits).toEqual([]);
  });

  it("has no active circleCliBin references", () => {
    const hits = grep("circleCliBin", searchPaths);
    expect(hits).toEqual([]);
  });

  it("has no erc8004.register_via_circle_cli references", () => {
    const hits = grep("erc8004.register_via_circle_cli", searchPaths);
    expect(hits).toEqual([]);
  });

  it("has no packages/runner/dist/index.js references in scripts or docs", () => {
    const hits = grep("packages/runner/dist/index.js", ["scripts", "docs"]);
    expect(hits).toEqual([]);
  });

  it("has no ARCLAYER_AGENT_ID=agent- slug assignment in scripts or docs", () => {
    const hits = grep("ARCLAYER_AGENT_ID=agent-", ["scripts", "docs"]);
    expect(hits).toEqual([]);
  });

  it("installer uses arclayer-provider PM2 service name", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("--name arclayer-provider");
    expect(installer).toContain("start -- provider");
  });

  it("installer uses arclayer-langchain-runtime PM2 service name", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("--name arclayer-langchain-runtime");
  });

  it("installer uses arclayer-runner PM2 service name", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("--name arclayer-runner");
  });

  it("installer rejects private key env vars", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("PRIVATE_KEY");
    expect(installer).toContain("does not accept private keys");
  });

  it("installer requires CIRCLE_CHAIN=ARC-TESTNET", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("ARC-TESTNET");
    expect(installer).toContain("CIRCLE_CHAIN must be ARC-TESTNET");
  });

  it("installer requires ARCLAYER_MCP_TOKEN", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("ARCLAYER_MCP_TOKEN");
  });

  it("installer does not hardcode /opt/arclayer in PM2 commands", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    // PM2 source lines should use $INSTALL_DIR, not hardcoded /opt/arclayer
    const pm2Lines = installer.split("\n").filter((l: string) => l.includes("pm2 start") && l.includes("source"));
    for (const line of pm2Lines) {
      expect(line).not.toContain("source /opt/arclayer/");
      expect(line).toContain("${INSTALL_DIR}");
    }
  });

  it("installer outputs identity path using $HOME not $INSTALL_DIR", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("Identity file: $HOME/.arclayer/runner/identity.json");
    expect(installer).not.toContain("Identity: $INSTALL_DIR/.arclayer");
  });

  it("installer uses pnpm --filter for identity ensure", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("pnpm --filter @arclayer/runner start -- identity ensure");
    expect(installer).not.toContain("node packages/runner/dist/index.js identity ensure");
  });

  it("installer writes ARCLAYER_AGENT_NAME and ARCLAYER_AGENT_SLUG", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("ARCLAYER_AGENT_NAME=${AGENT_NAME}");
    expect(installer).toContain("ARCLAYER_AGENT_SLUG=${AGENT_SLUG}");
  });

  it("installer does NOT write ARCLAYER_AGENT_ID as slug", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    // Should not have ARCLAYER_AGENT_ID=agent-... pattern
    expect(installer).not.toMatch(/ARCLAYER_AGENT_ID=agent-\$/);
    expect(installer).not.toContain("AGENT_ID=\"agent-$(slugify");
  });

  it("installer patches ARCLAYER_AGENT_ID only after confirmed identity", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("Patching ARCLAYER_AGENT_ID=$TOKEN_ID");
    expect(installer).toContain("ARCLAYER_AGENT_ID not set in .env.runner");
  });

  it("installer refuses to start provider if tokenId missing", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("ARCLAYER_AGENT_ID not set in .env.runner. Provider cannot start");
  });

  it("installer builds SDK before runner", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    const sdkPos = installer.indexOf("pnpm --filter @arclayer/sdk build");
    const runnerPos = installer.indexOf("pnpm --filter @arclayer/runner build");
    expect(sdkPos).toBeGreaterThan(-1);
    expect(runnerPos).toBeGreaterThan(-1);
    expect(sdkPos).toBeLessThan(runnerPos);
  });

  it("installer builds Circle Dev Wallet adapter before runner", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    const adapterPos = installer.indexOf("pnpm --filter @arclayer/circle-dev-wallet-adapter build");
    const runnerPos = installer.indexOf("pnpm --filter @arclayer/runner build");
    expect(adapterPos).toBeGreaterThan(-1);
    expect(runnerPos).toBeGreaterThan(-1);
    expect(adapterPos).toBeLessThan(runnerPos);
  });
});

describe("live test script validation", () => {
  it("requires --live-arc-testnet flag", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("--live-arc-testnet");
    expect(script).toContain("requires --live-arc-testnet");
  });

  it("requires --job-id argument", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("--job-id");
    expect(script).toContain("requires --job-id");
  });

  it("refuses mock/static job data", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("Mock job data is not accepted");
  });

  it("validates CIRCLE_CHAIN=ARC-TESTNET", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("CIRCLE_CHAIN must be ARC-TESTNET");
  });

  it("validates the requested job exists and provider matches", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("Job $JOB_ID exists");
    expect(script).toContain("Job provider matches local wallet");
    expect(script).toContain("Cannot validate non-existent job");
    expect(script).toContain("Cannot validate");
  });

  it("uses HMAC-authenticated request for wallet balance", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("runner_hmac_request");
    expect(script).toContain("HMAC-authenticated");
    expect(script).toContain("authenticated");
  });

  it("supports --skip-balance-check for bypassing authenticated check", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("--skip-balance-check");
    expect(script).toContain("SKIP_BALANCE_CHECK");
  });

  it("fails on wrong/missing job ID", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("requires --job-id");
    expect(script).toContain("Mock job data is not accepted");
    expect(script).toContain("Invalid job ID format");
  });

  it("validates job status lifecycle codes", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    expect(script).toContain("Job status: Open");
    expect(script).toContain("Job status: Funded");
    expect(script).toContain("Job status: Submitted");
    expect(script).toContain("Job status: Completed");
    expect(script).toContain("Job status: Rejected");
  });

  it("does not print success without verifying job", () => {
    const script = readRelative("scripts/live-test-autonomous-provider-arc.sh");
    // Must fail if job not found or provider mismatch
    expect(script).toContain("die \"Cannot validate non-existent job");
    expect(script).toContain("die \"Job is assigned to a different provider");
  });
});

describe("CLI command validation", () => {
  it("index.ts has provider as primary command", () => {
    const index = readRelative("apps/arclayer-runner/src/index.ts");
    expect(index).toContain('.command("provider")');
    expect(index).toContain("Run the autonomous ERC-8183 provider service");
  });

  it("index.ts has provider-worker as deprecated alias", () => {
    const index = readRelative("apps/arclayer-runner/src/index.ts");
    expect(index).toContain('.command("provider-worker")');
    expect(index).toContain("[deprecated]");
    expect(index).toContain("provider-worker is deprecated");
  });

  it("index.ts has identity ensure command", () => {
    const index = readRelative("apps/arclayer-runner/src/index.ts");
    expect(index).toContain('.command("identity")');
    expect(index).toContain('.command("ensure")');
    expect(index).toContain("--auto-register");
  });

  it("index.ts passes walletAddress to ensureIdentity", () => {
    const index = readRelative("apps/arclayer-runner/src/index.ts");
    expect(index).toContain("walletAddress: config.circleWalletAddress");
  });

  it("index.ts passes idempotencyKey through registerFn", () => {
    const index = readRelative("apps/arclayer-runner/src/index.ts");
    expect(index).toContain("idempotencyKey: string");
    expect(index).toContain("metadataURI, idempotencyKey");
  });

  it("index.ts passes finalizeFn to ensureIdentity", () => {
    const index = readRelative("apps/arclayer-runner/src/index.ts");
    expect(index).toContain("finalizeFn:");
    expect(index).toContain("finalizeIdentityRegistration");
  });

  it("index.ts shows confirmed_pending as success", () => {
    const index = readRelative("apps/arclayer-runner/src/index.ts");
    expect(index).toContain('result.action === "confirmed_pending"');
  });

  it("services.ts has finalizeIdentityRegistration method", () => {
    const source = readRelative("apps/arclayer-runner/src/services.ts");
    expect(source).toContain("async finalizeIdentityRegistration(");
    expect(source).toContain("getTransactionReceipt");
    expect(source).toContain("decodeEventLog");
    expect(source).toContain("Transfer");
    expect(source).toContain("metadataURI");
  });
});

describe("provider worker code quality", () => {
  it("provider.ts uses wallet adapter wording, not CircleCliAdapter", () => {
    const provider = readRelative("apps/arclayer-runner/src/workers/provider.ts");
    expect(provider).not.toContain("CircleCliAdapter");
    expect(provider).toContain("wallet adapter");
  });

  it("provider.ts setBudget passes decimal amount", () => {
    const provider = readRelative("apps/arclayer-runner/src/workers/provider.ts");
    // Should pass proposedBudget (decimal), not budgetAtomic
    expect(provider).toContain("amount: proposedBudget");
    expect(provider).not.toContain("amount: budgetAtomic");
  });
});

describe("identity-ensure code quality", () => {
  it("has no dynamic require calls", () => {
    const source = readRelative("apps/arclayer-runner/src/identity-ensure.ts");
    expect(source).not.toMatch(/require\(["']node:fs["']\)/);
    expect(source).not.toMatch(/require\(["']fs["']\)/);
  });

  it("uses atomic exclusive lock (openSync wx)", () => {
    const source = readRelative("apps/arclayer-runner/src/identity-ensure.ts");
    expect(source).toContain('openSync(lockPath, "wx")');
  });

  it("generates idempotencyKey for identity mint", () => {
    const source = readRelative("apps/arclayer-runner/src/identity-ensure.ts");
    expect(source).toContain("generateIdempotencyKey");
    expect(source).toContain("erc8004-register:");
  });

  it("accepts finalizeFn for pending tx finalization", () => {
    const source = readRelative("apps/arclayer-runner/src/identity-ensure.ts");
    expect(source).toContain("finalizeFn");
    expect(source).toContain("finalizePendingIdentity");
  });
});
