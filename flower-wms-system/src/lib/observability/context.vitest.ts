import { describe, expect, it } from "vitest";
import { getLogContext, runWithLogContext } from "./context";

describe("log context", () => {
  it("returns no context outside a run", () => {
    expect(getLogContext()).toEqual({});
  });

  it("exposes correlation IDs to the callback and returns its value", () => {
    const result = runWithLogContext({ requestId: "req-abcdef12", runId: "run-1" }, () => {
      expect(getLogContext()).toEqual({ requestId: "req-abcdef12", runId: "run-1" });
      return 42;
    });
    expect(result).toBe(42);
    expect(getLogContext()).toEqual({});
  });

  it("keeps correlation IDs across await boundaries", async () => {
    await runWithLogContext({ requestId: "req-async-1" }, async () => {
      await Promise.resolve();
      expect(getLogContext().requestId).toBe("req-async-1");
    });
    expect(getLogContext()).toEqual({});
  });

  it("isolates concurrent contexts", async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithLogContext({ requestId: "req-concurrent-a" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(getLogContext().requestId ?? "missing");
      }),
      runWithLogContext({ requestId: "req-concurrent-b" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(getLogContext().requestId ?? "missing");
      }),
    ]);
    expect(seen.sort()).toEqual(["req-concurrent-a", "req-concurrent-b"]);
  });

  it("allows nested contexts to override the parent", () => {
    runWithLogContext({ requestId: "outer", runId: "run-outer" }, () => {
      runWithLogContext({ requestId: "inner" }, () => {
        expect(getLogContext()).toEqual({ requestId: "inner" });
      });
      expect(getLogContext()).toEqual({ requestId: "outer", runId: "run-outer" });
    });
  });
});
