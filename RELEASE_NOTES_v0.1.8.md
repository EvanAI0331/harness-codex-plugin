# Harness Codex Plugin v0.1.8

Harness v0.1.8 strengthens the plugin as a fail-closed Codex workflow framework.

## What Changed

- Added workflow contract schema at `shared/schemas/harness-workflow.schema.json`.
- Added workflow templates for `software_delivery`, `research_ops`, and `content_pipeline`.
- Added CLI commands:
  - `list-workflow-templates`
  - `init-workflow`
  - `verify-workflow`
- Added MCP tools:
  - `harness.list_workflow_templates`
  - `harness.init_workflow`
  - `harness.verify_workflow`
- Cleared npm audit moderate vulnerabilities with a PostCSS override and dependency metadata refresh.
- Expanded tests and GitHub Actions coverage.

## Install

```bash
codex plugin marketplace add https://github.com/EvanAI0331/harness-codex-marketplace.git --ref v0.1.8
```

## Verification

Run before release:

```bash
npm run plugin:verify
npm run plugin:verify-specs
npm audit --audit-level=moderate
/opt/homebrew/bin/python3.11 -m pytest
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```
