import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

interface AddedTool {
  name: string;
  description: string;
}

function fakeContext(root: string) {
  const tools: AddedTool[] = [];
  const hooks: Array<(input: { system: Array<{ type: "text"; text: string }> }) => void> = [];
  const disposed: string[] = [];
  const context = {
    location: { project: { canonical: root }, directory: root },
    tool: {
      async transform(edit: (editor: { add: (tool: AddedTool) => void }) => void) {
        edit({ add: (tool) => tools.push(tool) });
        return { dispose: async () => disposed.push("tools") };
      },
    },
    session: {
      async hook(name: string, callback: (input: { system: Array<{ type: "text"; text: string }> }) => void) {
        expect(name).toBe("context");
        hooks.push(callback);
        return { dispose: async () => disposed.push("context") };
      },
    },
  };
  return { context, tools, hooks, disposed };
}

describe("plugin registration", () => {
  it("registers exactly six tools and the route context", async () => {
    const root = mkdtempSync(join(tmpdir(), "vstack-plugin-"));
    const { context, tools, hooks, disposed } = fakeContext(root);

    const cleanup = await plugin.setup(context as never);

    expect(plugin.id).toBe("vstack");
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "vstack_close",
      "vstack_decision",
      "vstack_evidence",
      "vstack_handoff",
      "vstack_route",
      "vstack_task",
    ]);
    expect(tools.every((tool) => tool.description.length > 20)).toBe(true);
    expect(hooks).toHaveLength(1);

    const system: Array<{ type: "text"; text: string }> = [];
    hooks[0]!({ system });
    hooks[0]!({ system });
    expect(system).toHaveLength(1);
    expect(system[0]!.text).toContain("[vstack:route]");

    await cleanup?.();
    expect(disposed.sort()).toEqual(["context", "tools"]);
  });
});
