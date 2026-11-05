# @vipintom/vstack-opencode

The vstack recorder for OpenCode. It keeps the record the method would otherwise maintain by hand, and refuses the transitions the method forbids.

The Markdown pack works without this plugin. This plugin is the optional cockpit for OpenCode.

## What it does

- Opens one delivery and tracks its playbook, tier and phase.
- Tracks tasks, each with the check that proves it.
- Records evidence: claim, command, result, artifact.
- Records decisions: choice, alternatives, reason, consequence.
- Records handoffs: state, next action, blockers, tree status.
- Closes a delivery only when the work is actually complete, and writes a durable Markdown record.

It does not run project commands, call models, or write outside `.vstack/`.

## Tools — exactly six

| Tool | Purpose |
|---|---|
| `vstack_route` | Open, switch or read the active delivery; no arguments reads state |
| `vstack_task` | Add, start or complete a task; completion requires evidence |
| `vstack_evidence` | Record claim, command, result and artifact |
| `vstack_decision` | Record choice, alternatives, reason, consequence and owner |
| `vstack_handoff` | Record state, next action, blockers and tree status |
| `vstack_close` | Validate, write the close record and finish or park the delivery |

There is no seventh tool.

## Enforcement

- A task cannot complete without an evidence reference.
- A delivery cannot close with open tasks or failed required checks.
- A waiver requires a reason and a named owner.
- History is append-only.
- A phase moves forward, or backward with a recorded reason.
- One active delivery at a time.

## State

State lives in `.vstack/` inside the project:

- `.vstack/state.json` — the current delivery, with revision and schema version.
- `.vstack/history.jsonl` — append-only events.
- `.vstack/deliveries/<id>.json` and `.vstack/deliveries/<id>.md` — every closed delivery, retained so the panel can list and reopen the record.

`state.json` and `history.jsonl` are transient and ignored by git. Delivery records are committable and readable without the plugin. A schema version lets the panel refuse a format it does not understand.

## Install

```bash
opencode plugin add @vipintom/vstack-opencode
```

Or from a clone, point the project config at the directory:

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

Register in `opencode.jsonc` if your setup does not do it automatically:

```jsonc
{
  "plugins": ["@vipintom/vstack-opencode"]
}
```

## Compatibility

- OpenCode: latest release at the time of vstack 0.2.0.
- State schema: 1.
- Panel: `@vstack/openchamber` 0.2.0 reads schema 1.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Licence

MIT.
