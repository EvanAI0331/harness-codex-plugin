# CLI

Harness includes a small verification CLI:

```bash
python3 scripts/harness_cli.py verify-plugin .
python3 scripts/harness_cli.py verify-specs .
python3 scripts/harness_cli.py list-workflow-templates .
python3 scripts/harness_cli.py init-workflow --template software_delivery --output ./harness.workflow.json
python3 scripts/harness_cli.py verify-workflow ./harness.workflow.json
python3 scripts/harness_cli.py explain .
```

NPM shortcuts:

```bash
npm run plugin:verify
npm run plugin:verify-specs
npm run plugin:explain
```

## Semantics

- `verify-plugin` checks Codex plugin metadata, skills, MCP config, and marketplace metadata.
- `verify-specs` checks role, execution, output, and manifest specs across required spec families.
- `list-workflow-templates` lists built-in workflow contract templates.
- `init-workflow` writes a workflow contract skeleton. It does not execute the workflow or produce success artifacts.
- `verify-workflow` checks required roles, LLM-driven role declarations, gates, artifacts, failure semantics, and execution policy.
- `explain` returns a combined status packet.

Failure returns `ok=false`, `failure_state`, and structured `details`. The CLI does not infer success from partial metadata.
