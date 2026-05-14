# Harness Codex Plugin

Harness is packaged as a Codex plugin with three surfaces:

- Skills for workflow building, runtime verification, and packaging.
- CLI verification for plugin metadata and spec completeness.
- MCP tools that expose the same verification behavior to Codex.

The plugin is intentionally fail-closed. If required metadata, specs, gates, artifacts, or runtime evidence are unavailable, the result must be `ok=false` with an explicit `failure_state`.

## Layout

```text
.codex-plugin/plugin.json
.mcp.json
.agents/plugins/marketplace.json
skills/
scripts/
shared/specs/
shared/schemas/
docs/
tests/
```

## Agent Boundary

Harness only treats a component as an agent when its core decision is LLM-driven and it has role, execution, and output specs. Script-only utilities are tools, not agents.
