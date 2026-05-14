# Demo Mode

`DEMO_MODE=true` keeps the orchestration real and swaps adapter implementations so you can explore the product without live provider credentials.

## Run It

```bash
cp .env.example .env
npm run demo
```

If you already have a local `.env`, set:

```bash
DEMO_MODE=true
```

## What Demo Mode Does

- Uses mock / local adapters for LLM, spec compilation, GitHub search, and Agent Reach tool resolution
- Keeps build / run / task instance / artifact state machines real
- Persists data into SQLite
- Preserves the real workspace, run detail page, and artifact flow

## Minimal Demo Flow

1. Open `/harness/new`
2. Create a harness
3. Enter a Harness Goal
4. Click **Generate Harness**
5. Open the workspace at `/harness/[id]`
6. Click **Run New Task**
7. Enter a **Run Task Instruction**
8. Open `/runs/[runId]`
9. Inspect:
   - Final Deliverable
   - Final Report
   - Artifacts
   - Runtime Trace

## Sample Demo Harness

The public demo harness is named **Repository Audit Harness**.

It is designed to:

- inspect a repository structure
- explain architecture
- verify runtime boundaries
- produce artifact-based outputs

## Notes

- Demo mode is for local exploration and OSS onboarding.
- It is not a substitute for production credentials or production hardening.
