/**
 * Installer and script validation tests.
 *
 * Verifies:
 *   - No CIRCLE_CLI_BIN references in active code
 *   - No erc8004.register_via_circle_cli references
 *   - Installer PM2 service uses arclayer-provider
 *   - Installer does not accept private keys
 *   - Live test script requires --live-arc-testnet
 *   - Live test script refuses mock job data
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
    expect(installer).toContain("Identity: $HOME/.arclayer/runner/identity.json");
    expect(installer).not.toContain("Identity: $INSTALL_DIR/.arclayer");
  });

  it("installer slugifies agent name for ARCLAYER_AGENT_ID", () => {
    const installer = readRelative("scripts/install-autonomous-provider.sh");
    expect(installer).toContain("slugify");
    expect(installer).toContain("AGENT_ID=\"agent-$(slugify");
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
