---
name: harness-runtime-verifier
description: Verify Harness specs, runtime traces, gates, artifacts, and failure states.
---

# Harness Runtime Verifier

Use this skill when checking whether a Harness build or run is valid.

Verification policy:
- Fail closed when a required spec, gate, artifact, trace, or failure state is missing.
- Require role, execution, and output specs for every real agent.
- Require compiled SpecX contract evidence where the runtime expects SpecX governance.
- Treat failed or blocked runs as valid only when the failure is explicit and evidenced.
- Never convert missing final deliverables into success.
- Never accept mock/demo output as production execution evidence.

Useful commands:

```bash
python3 scripts/harness_cli.py verify-plugin .
python3 scripts/harness_cli.py verify-specs .
npm run typecheck
npm run test:smoke
```
