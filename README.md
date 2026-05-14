# Harness Codex Plugin

Official Codex Plugin Directory publishing is not yet self-serve.
Harness is currently distributed through a GitHub-backed Codex marketplace.

```bash
codex plugin marketplace add https://github.com/BTCNAI/harness-codex-marketplace.git --ref v0.1.1
```

Harness is the workflow framework for custom Codex agent systems.
It turns vague workflows into role-bound, execution-bound, output-bound harnesses.
It prevents fake success, silent fallback, and uncontrolled script-only execution.

Harness Studio is the included visual workbench for building, inspecting, and running structured multi-agent harnesses. It pairs a single workspace with task instances, capability registries, artifact-based execution traces, and a task-oriented runtime so you can see what the system built, what it ran, and what it delivered.

This repository is an open-source OSS skeleton with a real runtime path, not a production-hardened platform and not a mock-only demo site.

## Core Features

- Codex Plugin packaging with skills, CLI checks, MCP tools, and repo marketplace distribution
- Single workspace for harness generation and editing
- Independent run instances with their own task instructions
- Task instance planning that drives multi-agent execution
- Capability registry and capability resolution
- Artifact-based outputs for task instances, node outputs, tool results, and final deliverables
- Runtime trace and event stream
- Demo mode for offline or low-friction local exploration
- SQLite-backed persistence

## Why Harness

Codex needs a workflow layer when tasks grow beyond one-shot prompts.
Harness supplies that layer: graph, specs, capabilities, run instances, artifacts, and trace.
The result is a repeatable framework for custom agent work instead of freestyle execution.

## Core Concepts

- **Harness Goal**: The long-lived purpose of the harness. This belongs in the workspace intake area.
- **Run Task Instruction**: The task for one specific run. This belongs in the run entry flow.
- **Build**: Generates or rebuilds the harness graph, specs, and capabilities.
- **Run**: Executes one task against a built harness.
- **Task Instance**: The persisted run plan that agent execution reads from.
- **Artifact**: The primary unit of progress and result storage.
- **Final Deliverable**: The task result produced by the responsible agent.
- **Trace**: The runtime event history for build and run.

## Architecture

At a high level:

- **Workbench**: `src/components/HarnessWorkspace.tsx`
- **Build orchestrator**: `src/lib/build-orchestrator.ts`
- **Run orchestrator**: `src/lib/run-orchestrator.ts`
- **Adapters**: `src/lib/llm`, `src/lib/specx`, `src/lib/scriptx`, `src/lib/capabilities`, `src/lib/runtime`
- **Artifact layer**: `src/lib/artifact-repository.ts`, `src/lib/run-output/final-deliverable-aggregator.ts`
- **Persistence**: SQLite in `src/lib/sqlite.ts`
- **Streaming**: SSE via `src/lib/useEventStream.ts`

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

Copy `.env.example` to `.env` and adjust the values you need.

Important:

- `credentialRef` is a server-side pointer to a secret environment variable.
- Example: `credentialRef=OPENAI_MAIN` means the server reads `OPENAI_MAIN_API_KEY`.
- The browser never receives raw API keys.

### 3. Demo Mode

```bash
npm run demo
```

Demo mode keeps the orchestrator real and swaps only adapter implementations so you can explore the flow without live credentials.

### 4. Run the App

```bash
npm run dev
```

Then open:

- `/harness/[id]` for the workspace
- `/runs/[runId]` for run results
- `/harness/settings` for runtime settings

### 5. Smoke Test

```bash
npm run test:smoke
```

The smoke test runs the app in `DEMO_MODE=true`, verifies SQLite initialization, harness creation, build, run, artifact retrieval, and final deliverable availability.

## Demo Scenario

The repository includes a public demo flow built around a **Repository Audit Harness**.

Typical flow:

1. Create a harness
2. Enter a Harness Goal
3. Generate Harness
4. Run New Task
5. Enter a Run Task Instruction
6. Open `/runs/[runId]`
7. Inspect Final Deliverable, Final Report, Artifacts, and Runtime Trace

## Pages

- `/harness/[id]` - main workspace
- `/runs/[runId]` - run detail view
- `/harness/settings` - runtime settings

## Current Limitations

- This is an OSS skeleton, not a production-hardened multi-tenant service.
- Default adapters may use demo/mock implementations when `DEMO_MODE=true`.
- Some integrations are pluggable placeholders and may need real credentials or local setup.
- Security boundaries, tenancy isolation, and hardening are still in progress.

## Scripts

- `npm run dev`
- `npm run demo`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run plugin:verify`
- `npm run plugin:verify-specs`
- `npm run test:smoke`
- `npm run db:reset`

## Codex Plugin

The plugin entrypoint is `.codex-plugin/plugin.json`.

Codex skills:

- `harness-workflow-builder`
- `harness-runtime-verifier`
- `harness-plugin-packager`

MCP tools:

- `harness.verify_plugin`
- `harness.verify_specs`
- `harness.explain`

All plugin verification commands fail closed. Missing specs, plugin metadata, skills, marketplace metadata, or MCP wiring return `ok=false` with `failure_state` and `details`.

## Documentation

- [Architecture](./ARCHITECTURE.md)
- [Codex Plugin](./docs/codex-plugin.md)
- [CLI](./docs/cli.md)
- [MCP Tools](./docs/mcp-tools.md)
- [Distribution](./docs/distribution.md)
- [Use Cases](./docs/use-cases.md)
- [Promotion](./docs/promotion.md)
- [Demo Guide](./docs/DEMO.md)
- [Roadmap](./docs/ROADMAP.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [License](./LICENSE)

## Third-Party Notices

Vendored dependencies are documented in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
