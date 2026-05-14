# Architecture

Harness Studio uses one workspace entry point and two execution flows:

- **Build**: generate and evolve the harness graph
- **Run**: execute a single task against a built harness

The system is intentionally split so build and run do not share the same phase logic or success criteria.

## 1. Single Workspace Model

The main workspace is `/harness/[id]`.

It owns:

- Harness Goal intake
- Capability policy intake
- Build / Rebuild actions
- Run New Task entry
- Graph, inspector, and build/runtime drawers

`/harness/new` only creates a new harness and redirects back to the workspace.

## 2. Build / Run Separation

### Build

The build path creates or updates the harness graph.

Relevant code:

- `src/lib/build-orchestrator.ts`
- `src/lib/planner/*`
- `src/lib/specx/*`
- `src/lib/scriptx/*`
- `src/lib/capabilities/*`

Build is responsible for:

- planning
- composing the blueprint
- resolving capabilities
- compiling specs and scripts
- assembling the graph

Build does not execute runtime tasks.

### Run

The run path consumes a persisted task instance and produces task artifacts.

Relevant code:

- `src/lib/run-orchestrator.ts`
- `src/lib/runtime/*`
- `src/lib/run-output/*`
- `src/lib/task/*`

Run is responsible for:

- task instance planning
- agent runtime decisions
- capability selection
- tool / skill / script execution
- node output artifacts
- final deliverable aggregation
- final report generation as an auxiliary output

## 3. State Machines

The project uses explicit state transitions:

- `src/lib/harness-machine.ts`
- `src/lib/run-machine.ts`

States are not mutated directly from components or routes.

## 4. Task Instance Layer

The task instance is the authoritative run plan.

Persisted fields include:

- `id`
- `runId`
- `harnessId`
- `instruction`
- `goal`
- `constraints`
- `successCriteria`
- `perAgentAssignments`
- `finalDeliverable`
- `planningSummary`

Agents read the task instance, not just the raw task instruction string.

## 5. Artifact Layer

Artifacts are the main runtime output unit.

Supported artifact types include:

- `task.instance`
- `agent.plan`
- `agent.output`
- `tool.result`
- `spec.validation`
- `final.deliverable`
- `final.report`
- `error.report`

The run detail view is artifacts-first.

## 6. Final Deliverable

`src/lib/run-output/final-deliverable-aggregator.ts` collects the key node artifacts and requires a real `final.deliverable` artifact.

The final report is a secondary summary, not the primary task result.

## 7. Adapters

The codebase uses adapter boundaries so runtime can be swapped or demoed without replacing the orchestrator.

- **LLM**: `src/lib/llm/*`
- **SpecX**: `src/lib/specx/*`
- **Capability resolution**: `src/lib/capabilities/*`
- **Runtime execution**: `src/lib/runtime/*`
- **Script authoring and compilation**: `src/lib/scriptx/*`

`DEMO_MODE=true` swaps only adapter implementations.

## 8. SQLite and SSE

- SQLite database bootstrap lives in `src/lib/sqlite.ts`
- Event streaming lives in `src/lib/useEventStream.ts`
- Harness and run events are persisted and pushed through SSE

## 9. Code Map

```text
src/
  app/
    api/
    harness/
    runs/
  components/
  lib/
    capabilities/
    llm/
    planner/
    run-output/
    runtime/
    scriptx/
    specx/
    task/
shared/
  prompts/
  registries/
  schemas/
  specs/
  types/
```
