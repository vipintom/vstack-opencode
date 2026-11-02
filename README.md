# @vstack/opencode

**OpenCode runtime plugin for vstack — workflow engine, agents, tools, projections for OpenChamber.**

Provides persistent memory, delivery/task tracking, agent coordination, evidence-based checks, and projection publishing for the vstack workflow ecosystem.

## Installation

```bash
# Production (when published to npm)
npm install @vstack/opencode

# Development (from local clone)
npm install /path/to/vstack-opencode
```

Register in `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "./node_modules/@vstack/opencode" }
  ]
}
```

## Features

### Persistent Memory
- Project knowledge surviving sessions
- Memory store with CRUD operations
- Lesson capture and promotion

### Delivery/Task Tracking
- Lightweight CRUD with contracts, dependencies
- Phase-based workflow tracking
- Assignment, decision, checkpoint stores

### Agent Coordination
- Dispatch builders/reviewers with handoff recording
- Subagent dispatch via OpenCode `task` tool
- Agent run history and state

### Evidence-Based Checks
- Executed tests/builds/lint with provenance
- 6 completion gates enforced before task/delivery completion
- Evidence ledger with code identity (commit SHA + diff fingerprint)

### Projection Producer
- Generates OpenChamber-compatible v1 projections
- Delivery reports, activity reports, memory index, quality summaries
- Published automatically on vstack tool completion

### 23 Tools
| Category | Tools |
|----------|-------|
| Status | `vstack_status`, `vstack_workflow` |
| Memory | `vstack_memory_read`, `vstack_memory_write`, `vstack_memory_list` |
| History | `vstack_history_read`, `vstack_history_write` |
| Delivery | `vstack_delivery_create`, `vstack_delivery_update`, `vstack_delivery_list` |
| Task | `vstack_task_create`, `vstack_task_update`, `vstack_task_list`, `vstack_task_graph` |
| Agent | `vstack_agent_dispatch`, `vstack_agent_handoff` |
| Check | `vstack_check_create`, `vstack_check_verify`, `vstack_check_list` |
| Phase 2 | `vstack_assignment`, `vstack_decision`, `vstack_checkpoint`, `vstack_lesson`, `vstack_recovery`, `vstack_verification`, `vstack_session_pickup`, `vstack_verification_skill`, `vstack_skill_validate`, `vstack_verification_maintain`, `vstack_evaluation`, `vstack_lesson_promotion` |
| Review | `vstack_review_start`, `vstack_review_findings`, `vstack_review_resolve` |

### Slash Commands
- `/vstack` — Show status and available actions
- `/vstack-start` — Start a new delivery workflow
- `/vstack-status` — Show current workflow status
- `/vstack-review` — Start a review cycle
- `/vstack-resume` — Resume interrupted workflow
- `/vstack-report` — Generate delivery report

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Typecheck
pnpm typecheck

# Lint
pnpm lint

# Test (103 tests)
pnpm test

# Test with watch
pnpm test:watch

# Package for distribution
pnpm pack:prod
```

## Architecture

```
src/
├── index.ts                    # Plugin entry point
├── agents/                     # Agent installer, run store
├── dashboard/                  # Projection publisher
├── deliveries/                 # Delivery store
├── enforcement/                # Enforcement service
├── evaluation/                 # Evaluation suite
├── history/                    # History service
├── lifecycle/                  # Legacy lifecycle engine
├── memory/                     # Memory store
├── orchestration/              # Agent dispatch, coordinator, scheduler
├── persistence/                # File store, event log, locks, repository root
├── policy/                     # Approvals, autonomy, permissions
├── quality/                    # Checks, evidence, gates, test, verification
├── recovery/                   # Reconciliation, recovery manager
├── release/                    # Deployment, post-release, rollback
├── reviews/                    # Findings, resolution, orchestrator, rubrics
├── runtime/                    # State management
├── schemas/                    # Type definitions
├── skills/                     # Lesson promotion, skill loader, validation
├── tasks/                      # Task store, assignment, decision, graph
└── tools/                      # 23 tool implementations
```

## Projection Protocol

Produces projections conforming to **vstack projection protocol v1** (defined in umbrella repository `contracts/projections/v1/`):

- `manifest.json` — Project manifest
- `state/index.json` — Dashboard index
- `deliveries/*/delivery.json` — Delivery metadata
- `deliveries/*/phases/*.json` — Phase runs
- `deliveries/*/tasks/*.json` — Tasks
- `deliveries/*/reviews/*.json` — Reviews
- `deliveries/*/quality/*.json` — Quality gates
- `deliveries/*/evidence/*.json` — Evidence

## Requirements

- OpenCode >= 2.2.0
- Node.js >= 20
- `@opencode/plugin` 2.2.0, `@opencode/schema` 2.2.0

## License

MIT