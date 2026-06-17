import { describe, it, expect, vi } from "vitest";

vi.mock("langchain", () => ({
  createAgent: vi.fn((config) => config),
  tool: vi.fn((handler, config) => ({ ...config, invoke: handler })),
}));

describe("createArcLayerLangChainAgent", () => {
  it("passes the selected role into tool creation", async () => {
    const { createArcLayerLangChainAgent } = await import("../agent.js");

    const agent = createArcLayerLangChainAgent({
      model: "openai:gpt-4o",
      role: "x402-agent",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
      maxAmountUsdc: "0.001",
    }) as unknown as { tools: Array<{ name: string }> };

    const toolNames = agent.tools.map((tool) => tool.name);
    expect(toolNames).toContain("arclayer_x402_pay");
    expect(toolNames).toContain("arclayer_x402_batch_pay");
  });

  it("read-only role does not get payment tools", async () => {
    const { createArcLayerLangChainAgent } = await import("../agent.js");

    const agent = createArcLayerLangChainAgent({
      model: "openai:gpt-4o",
      role: "read-only",
      runnerUrl: "http://127.0.0.1:8787",
      runnerSecret: "secret",
    }) as unknown as { tools: Array<{ name: string }> };

    const toolNames = agent.tools.map((tool) => tool.name);
    expect(toolNames).toContain("arclayer_x402_inspect");
    expect(toolNames).not.toContain("arclayer_x402_pay");
    expect(toolNames).not.toContain("arclayer_x402_batch_pay");
  });
});
