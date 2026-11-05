# AGENTS.md — vstack-opencode

Version 0.2.2. The vstack recorder for OpenCode: exactly six tools, the only
writer of `.vstack/`, and enforced delivery transitions. TypeScript, with no
runtime `dependencies` beyond the host `@opencode/plugin` peer.

## Layout

| Path | Holds |
|---|---|
| `src/tools/index.ts` | The six tool definitions and their argument schemas |
| `src/service.ts` | Route, task, evidence, decision, handoff, close and the gates |
| `src/state/store.ts` | Reads and writes `.vstack/`: hash chain, gitignore, archive |
| `src/state/schema.ts` | Dependency-free state validation |
| `src/state/types.ts` | State contract, schema version 2 |
| `src/bootstrap.ts` | Plugin setup and the context hook |
| `test/*.test.ts` | Unit, contract and walkthrough coverage |

## Rules

- Exactly six tools. A seventh is a defect, not a feature.
- `.vstack/` is the only write target. No other file, no network, no shell.
- The recorder never executes a project command. It records the command that
  was run; it does not run one.
- Completion needs passing evidence linked to that task. Evidence with no
  `taskId` cannot satisfy it. When gates are declared at open, completion
  needs the matching `gateId`.
- A delivery opened without schema version `2` is refused, not migrated.
- Close refuses open tasks, missing evidence and failed task-linked evidence.
- A review that requests changes refuses close. An approved review is recorded.
- A waiver needs a reason and a named owner. It is recorded and never bypasses
  a gate.
- History is append-only and SHA-256 hash-chained. An edited, reordered or
  deleted line is refused on read.
- One active delivery at a time. `park` archives and frees the slot; `resume`
  restores it.
- A phase moves forward, or backward with a recorded reason.
- No runtime `dependencies`. OpenCode loads a local plugin directory by reading
  its files rather than installing that package's dependencies, so an installed
  package would fail to resolve and the plugin would never load.
- State schema version is `2`. Raising it is a breaking change for the panel; v1 state is refused, not migrated (requires recorder 0.2.2 / schema 2).

## Verification

```bash
pnpm typecheck
pnpm test
```

Release verification runs in Docker from the workspace that holds all three
repositories. The harness is not part of this repository:

```bash
./docker/test.sh plugin       # frozen install, typecheck, tests, build
./docker/opencode-smoke.sh    # six tools in a real session, 7 history events
./docker/playbooks-smoke.sh   # four playbooks to a closed delivery
```

A host-run `pnpm test` is not accepted release verification.

## Documents

- `README.md` — install, tools, enforcement, state, compatibility.
- `RELEASE-NOTES.md` — scope, enforcement and migration from 0.1.0.
- `LICENSE`, `NOTICE` — MIT and dependency credit.
