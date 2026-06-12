import { describe, expect, it } from "vitest";
import { parseMcpToolArgs, RUNNER_MCP_TOOLS } from "./mcp-schemas";

describe("Runner MCP schemas", () => {
  it("publishes valid object-shaped JSON Schema for every tool", () => {
    for (const tool of RUNNER_MCP_TOOLS) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.properties, tool.name).toBeDefined();
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it("derives required fields and URI formats from the Zod schemas", () => {
    const pay = RUNNER_MCP_TOOLS.find((tool) => tool.name === "x402.pay");

    expect(pay?.inputSchema.required).toEqual(["url", "maxAmountUsdc", "reason"]);
    expect((pay?.inputSchema.properties as Record<string, any>).url.format).toBe("uri");
  });

  it("uses the same Zod schema for call-time validation", () => {
    expect(() => parseMcpToolArgs("x402.pay", {
      url: "not-a-url",
      maxAmountUsdc: "1",
      reason: "test"
    })).toThrow();

    expect(() => parseMcpToolArgs("x402.pay", {
      url: "https://api.example.com/resource",
      maxAmountUsdc: "1",
      reason: "test",
      unexpected: true
    })).toThrow();
  });
});
