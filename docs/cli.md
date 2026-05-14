# CLI

Harness includes a small verification CLI:

```bash
python3 scripts/harness_cli.py verify-plugin .
python3 scripts/harness_cli.py verify-specs .
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
- `explain` returns a combined status packet.

Failure returns `ok=false`, `failure_state`, and structured `details`. The CLI does not infer success from partial metadata.
