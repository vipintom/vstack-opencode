import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverChecks } from "../src/quality/check-discovery.js";

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function setup(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "vstack-checks-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
  }
  return root;
}

describe("check discovery", () => {
  it("maps package.json scripts to evidence checks", async () => {
    setup({
      "package.json": JSON.stringify({
        name: "demo",
        scripts: {
          build: "tsc",
          lint: "eslint src",
          typecheck: "tsc --noEmit",
          test: "vitest run",
          "test:integration": "vitest run --dir integration",
        },
      }),
    });

    const checks = await discoverChecks(root);
    const ids = checks.map((c) => c.id);

    expect(ids).toContain("build");
    expect(ids).toContain("lint");
    expect(ids).toContain("typecheck");
    expect(ids).toContain("test:unit");
    expect(ids).toContain("test:integration");
  });

  it("uses the package manager implied by the lockfile", async () => {
    setup({
      "package.json": JSON.stringify({ name: "demo", scripts: { build: "tsc" } }),
      "pnpm-lock.yaml": "lockfileVersion: 9.0",
    });

    const checks = await discoverChecks(root);
    const build = checks.find((c) => c.id === "build");

    expect(build?.command).toEqual(["pnpm", "run", "build"]);
    expect(build?.source).toBe("package.json");
  });

  it("ignores scripts that map to no evidence type", async () => {
    setup({
      "package.json": JSON.stringify({ name: "demo", scripts: { docs: "typedoc" } }),
    });

    const checks = await discoverChecks(root);

    expect(checks).toEqual([]);
  });

  it("discovers makefile targets", async () => {
    setup({
      "Makefile": "build:\n\ttsc\n\ntest:\n\tvitest run\n",
    });

    const checks = await discoverChecks(root);
    const ids = checks.map((c) => c.id);

    expect(ids).toContain("build");
    expect(ids).toContain("test:unit");
    expect(checks.find((c) => c.id === "build")?.source).toBe("makefile");
  });

  it("discovers turbo pipeline tasks", async () => {
    setup({
      "turbo.json": JSON.stringify({
        pipeline: {
          build: { outputs: ["dist/**"] },
          lint: {},
        },
      }),
    });

    const checks = await discoverChecks(root);
    const ids = checks.map((c) => c.id);

    expect(ids).toContain("build");
    expect(ids).toContain("lint");
  });

  it("returns an empty list when nothing is discoverable", async () => {
    setup({ "README.md": "nothing here" });

    expect(await discoverChecks(root)).toEqual([]);
  });
});
