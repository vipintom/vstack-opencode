# @vipintom/vstack-opencode

Version 0.2.2. The vstack recorder for OpenCode. It keeps the record the method
would otherwise maintain by hand, and refuses the transitions the method
forbids.

The Markdown pack works without this plugin. This plugin is the optional cockpit
for OpenCode.

## What it does

- Opens one delivery and tracks its playbook, tier and phase.
- Parks a delivery, opens another, and resumes the parked one.
- Tracks tasks, each with the check that proves it.
- Records evidence: claim, command, result, artifact and the task it proves.
- Records decisions: choice, alternatives, reason, consequence, owner.
- Records handoffs: state, next action, blockers, tree status.
- Records a review outcome and a waiver on close.
- Closes a delivery only when the work is actually complete, and writes a
  durable Markdown record.

It does not run project commands, call models, or write outside `.vstack/`.

## Tools — exactly six

| Tool | Purpose |
|---|---|
| `vstack_route` | Open, park, resume or read a delivery; no arguments reads state; a phase change moves forward, or backward with a reason |
| `vstack_task` | Add, start or complete a task; every task needs a check; completion requires evidence |
| `vstack_evidence` | Record claim, command, result, artifact and task |
| `vstack_decision` | Record choice, alternatives, reason, consequence and owner |
| `vstack_handoff` | Record state, next action, blockers and tree status |
| `vstack_close` | Validate, record the review and waiver, write the close record |

There is no seventh tool.

## Enforcement

- A task cannot complete without passing evidence for that task. When the
  delivery declares gates, completion needs the task's `gateId`.
- `vstack_task complete` accepts inline evidence; `vstack_task import` builds
  tasks from checklist lines.
- Evidence records the artifact's SHA-256 `digest`. Close refuses a missing
  or changed artifact.
- A delivery cannot close with open tasks, missing evidence or a failed
  required check.
- A review that requests changes refuses the close.
- A waiver requires a reason and a named owner. It is recorded; it does not
  override open tasks or failed checks.
- History is append-only and hash-chained; an edited or reordered entry is
  refused on read.
- A phase moves forward, or backward with a recorded reason.
- One active delivery at a time.

## State

State lives in `.vstack/` inside the project:

- `.vstack/state.json` — the current delivery, with revision and schema version.
- `.vstack/history.jsonl` — append-only, hash-chained events.
- `.vstack/deliveries/<id>.json` and `.vstack/deliveries/<id>.md` — every
  closed or parked delivery, retained so the panel can list and reopen it.
- `.vstack/.gitignore` — written on first use; keeps `state.json`,
  `history.jsonl` and the lock out of git while `deliveries/` stays committable.

Delivery records are readable without the plugin. A schema version lets the
panel refuse a format it does not understand.

## Install

### From a clone (recommended)

```bash
git clone https://github.com/vipintom/vstack-opencode.git
cd vstack-opencode
pnpm install
pnpm build
```

```jsonc
// opencode.jsonc in the project
{
  "plugins": ["/absolute/path/to/vstack-opencode"]
}
```

`opencode plugin add` accepts npm and Git packages only, not local paths. A
local plugin directory loads files, not package dependencies, so build it
first. The built recorder has no runtime dependencies beyond the host
`@opencode/plugin` peer.

### npm

After the package is published:

```bash
opencode plugin add @vipintom/vstack-opencode
```

or in `opencode.jsonc`:

```jsonc
{
  "plugins": ["@vipintom/vstack-opencode"]
}
```

### Offline

After one `pnpm install`, the clone builds and runs without network access.
Copy the built directory to the target machine; `dist/` and `package.json` are
enough.

### Windows

Use the absolute directory path with forward slashes in `opencode.jsonc`, for
example `C:/work/vstack-opencode`. The recorder resolves paths with Node's
`path` module and writes only inside the project's `.vstack/`.

## Uninstall

1. Remove the plugin entry from `opencode.jsonc`, or run
   `opencode plugin remove @vipintom/vstack-opencode`.
2. Delete the installed package directory.
3. Delete `.vstack/state.json`, `.vstack/history.jsonl` and `.vstack/lock`.
   Keep `.vstack/deliveries/`: those records are the durable output.

## Compatibility

- OpenCode V2; tested with the OpenCode CLI in `docker/Dockerfile`.
- Peer: `@opencode/plugin` >= 2.2.0.
- State schema: 2.
- Panel: `@vipintom/vstack-openchamber` 0.2.2 reads schema 2.

## Development

This repository has no test harness of its own. The Docker harness lives in
the workspace that holds all three vstack repositories and is not published
with any of them.

A standalone clone iterates with:

```bash
pnpm test
```

Release verification runs in Docker from that workspace root:

```bash
./docker/test.sh plugin
./docker/opencode-smoke.sh
```

A host-run `pnpm test` is not accepted release verification.

## Release notes and licence

- `RELEASE-NOTES.md` — scope, compatibility and the 0.1.0 migration.
- MIT. See `LICENSE` and `NOTICE`.
- Public repository, read-only: issues are welcome; pull requests are not
  accepted in 0.2.2.
