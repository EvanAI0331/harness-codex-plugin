# Stage 1 Release Notes

## Scope
- Removed frontend `apiKey` direct entry from model config flow.
- Introduced server-side credential resolution via `credentialRef`.
- Kept build/run separation and preserved the single-workspace structure.
- Strengthened task instance, artifact, and final deliverable flow.
- Added demo-mode adapters as scoped scaffolding, without replacing the orchestrator.

## Architecture Fixes
- `ModelConfig` now uses `credentialRef` instead of `apiKey`.
- Settings and build routes persist `LLM_CREDENTIAL_REF` and never expose secret values.
- LLM adapters resolve secrets on the server through `credentialRef -> ${REF}_API_KEY`.
- Task execution now reads persisted task instance data, not only raw run instruction text.
- Runtime agent execution produces `agent.plan`, `agent.output`, and `tool.result` artifacts as first-class outputs.
- Run finalization now requires `task.instance`, at least one agent output, and a `final.deliverable`.
- Final report remains auxiliary and is no longer treated as the primary task result.

## Demo Mode
- Added `DEMO_MODE` entry points for mock LLM, mock spec compiler, mock GitHub search, and mock Agent Reach tooling.
- Demo mode keeps the workflow/orchestrator real and only swaps adapters.

## UI Updates
- Run detail page now shows:
  1. Final Deliverable
  2. Final Report
  3. Artifacts
  4. Runtime Trace
- Missing final deliverable state is explicit.

## Notes
- The known Turbopack NFT warning still exists and is separate from this stage.
