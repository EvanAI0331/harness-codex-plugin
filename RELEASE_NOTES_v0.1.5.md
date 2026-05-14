# Harness Codex Plugin v0.1.5

Harness v0.1.5 packages Harness Studio as a Codex plugin and positions it as a workflow framework for custom Codex agent systems.

## Highlights

- Codex Plugin manifest and repo marketplace metadata.
- Three Codex skills: workflow builder, runtime verifier, and plugin packager.
- MCP server with `harness.verify_plugin`, `harness.verify_specs`, and `harness.explain`.
- Fail-closed CLI checks for plugin metadata and spec completeness.
- Strengthened execution specs with explicit LLM decision and capability stages.
- Documentation for installation, CLI, MCP tools, use cases, and promotion.
- CI smoke test process cleanup for GitHub Actions runners.

## Install

```bash
codex plugin marketplace add https://github.com/BTCNAI/harness-codex-marketplace.git --ref v0.1.5
```

## Verification

```bash
npm run plugin:verify
npm run plugin:verify-specs
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```
