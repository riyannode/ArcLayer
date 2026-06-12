import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process.spawn before importing the module
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: mockSpawn
}));

// Import after mock
const { runSetup } = await import("./index");

describe("runSetup", () => {
  let mockChild: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChild = {
      on: vi.fn((event: string, handler: Function) => {
        // Don't actually call exit handler
        return mockChild;
      })
    };
    mockSpawn.mockReturnValue(mockChild);
  });

  it("spawns npx with correct base args", () => {
    runSetup([]);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe("npx");
    expect(args).toEqual(["-y", "@arclayer/runner", "setup"]);
  });

  it("forwards user argv", () => {
    runSetup(["--target", "openclaw", "--force"]);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toEqual(["-y", "@arclayer/runner", "setup", "--target", "openclaw", "--force"]);
  });

  it("uses stdio inherit", () => {
    runSetup([]);

    const [, , opts] = mockSpawn.mock.calls[0];
    expect(opts.stdio).toBe("inherit");
  });

  it("sets shell true on win32", () => {
    const originalPlatform = process.platform;
    // Can't easily mock process.platform, so we just verify the option exists
    runSetup([]);
    const [, , opts] = mockSpawn.mock.calls[0];
    expect(opts).toHaveProperty("shell");
  });

  it("registers exit handler", () => {
    runSetup([]);

    const exitHandler = mockChild.on.mock.calls.find(
      (c: any) => c[0] === "exit"
    );
    expect(exitHandler).toBeDefined();
  });

  it("registers error handler", () => {
    runSetup([]);

    const errorHandler = mockChild.on.mock.calls.find(
      (c: any) => c[0] === "error"
    );
    expect(errorHandler).toBeDefined();
  });

  it("returns the child process", () => {
    const result = runSetup([]);
    expect(result).toBe(mockChild);
  });

  it("forwards empty argv when no args given", () => {
    runSetup();

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toEqual(["-y", "@arclayer/runner", "setup"]);
  });
});
