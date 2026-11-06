# vstack-opencode 0.2.2 release notes

**Released:** 2026-11-06
**Tag:** `v0.2.2`

## 0.2.2

Schema 2 with declared gates, `gateId` linkage, artifact SHA-256 digests,
inline evidence on complete, checklist import, session cache, and refusal of
v1 records. Six tools unchanged, no command execution. 51 tests green;
`docker/test.sh all` and 4/4 smokes green.

## Scope

The optional OpenCode recorder for the vstack method. It exposes exactly six
tools and is the only writer of `.vstack/`.

- `vstack_route` — open, park, resume, change phase, or read state.
- `vstack_task` — add, start, complete.
- `vstack_evidence` — record claim, check, result, artifact and task.
- `vstack_decision` — record choice, alternatives, reason, consequence, owner.
- `vstack_handoff` — record state, next action, blockers, tree status.
- `vstack_close` — validate and write the durable record.

There is no seventh tool, no CLI, no service and no database.

## Enforcement

- Completion needs passing evidence linked to the task.
- Close refuses open tasks, missing evidence and failed required checks.
- A review that requests changes refuses close; an approved review is recorded.
- A waiver needs a reason and an owner and is recorded; it does not bypass the
  close gates.
- History is append-only and SHA-256 hash-chained. An edited, reordered or
  deleted entry is refused on read.
- A phase moves forward, or backward with a reason.
- One active delivery at a time; park frees the slot and resume restores it.

## State

- `.vstack/state.json` — schema version 2, revision, current delivery.
- `.vstack/history.jsonl` — append-only hash chain.
- `.vstack/deliveries/<id>.json` and `.md` — closed and parked records.
- `.vstack/.gitignore` — keeps transient files out of git.

## Install

From a clone (works without registry access after one install):

```bash
git clone https://github.com/vipintom/vstack-opencode.git
cd vstack-opencode
pnpm install
pnpm build
```

```jsonc
{
  "plugins": ["/absolute/path/to/vstack-opencode"]
}
```

`opencode plugin add` accepts npm and Git packages only, not local paths. The
built recorder has no runtime dependencies beyond the host `@opencode/plugin`
peer.

After publication: `opencode plugin add @vipintom/vstack-opencode`.

## Compatibility

- OpenCode V2, tested with the CLI pinned in `docker/Dockerfile`.
- Peer: `@opencode/plugin` >= 2.2.0.
- State schema: 2.
- Panel: `@vipintom/vstack-openchamber` 0.2.2.
- Pack: any 0.2.2 pack; the pack does not require this plugin.

## Upgrade from 0.1.0

0.1.0 state, contracts and projections are not migrated.

1. Remove the 0.1.0 plugin from `opencode.jsonc` or the plugin list.
2. Delete the 0.1.0 plugin package.
3. Delete `.vstack/state.json`, `.vstack/history.jsonl` and `.vstack/lock`.
   Keep `.vstack/deliveries/` if you want the old records as plain files.
4. Install 0.2.2 as above and open a delivery with `vstack_route`.

A 0.2.2 history written by an earlier 0.2.2 pre-release without the hash chain
must be deleted and rebuilt; the recorder refuses an unchained history.

## Verification

The Docker harness lives in the workspace that holds all three vstack
repositories and is not published with this package. From that workspace root:

```bash
./docker/test.sh plugin
./docker/opencode-smoke.sh
./docker/skills-smoke.sh
./docker/playbooks-smoke.sh
```

The smoke scripts copy only `dist/` and `package.json`, so a runtime dependency
would fail them. A standalone clone runs `pnpm test` for iteration only.

## Licence

MIT. See `LICENSE` and `NOTICE`.
