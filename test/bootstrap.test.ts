import { describe, expect, it } from "vitest";
import { ensureRouteInstruction, ROUTE_MARKER } from "../src/bootstrap.js";

describe("bootstrap", () => {
  it("adds the route instruction once", () => {
    const system: Array<{ type: "text"; text: string }> = [];
    expect(ensureRouteInstruction(system)).toBe(true);
    expect(system).toHaveLength(1);
    expect(system[0]?.text).toContain(ROUTE_MARKER);
    expect(ensureRouteInstruction(system)).toBe(false);
    expect(system).toHaveLength(1);
  });

  it("does not duplicate an existing route instruction", () => {
    const system = [{ type: "text" as const, text: `${ROUTE_MARKER} call vstack_route` }];
    expect(ensureRouteInstruction(system)).toBe(false);
    expect(system).toHaveLength(1);
  });
});
