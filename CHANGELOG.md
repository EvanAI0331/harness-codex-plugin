# Changelog

## 0.1.8

- Cleared npm audit moderate findings by updating Next.js metadata and pinning PostCSS through package overrides.
- Added workflow contract schema, workflow templates, and example workflow contracts.
- Added fail-closed CLI commands for listing, initializing, and verifying Harness workflows.
- Added MCP tools for workflow template discovery, initialization, and verification with CLI-aligned semantics.
- Expanded tests for CLI workflow verification, MCP wrappers, and invalid workflow failure details.
- Updated GitHub Actions to run the full Python test suite and npm audit.

## 0.1.7

- Packaged Harness as a Codex plugin.
- Added plugin manifest, repo marketplace metadata, and MCP registration.
- Added Harness Codex skills for workflow building, runtime verification, and packaging.
- Added fail-closed CLI verification commands.
- Added MCP tools aligned with CLI behavior.
- Strengthened execution specs with explicit LLM decision and capability stages.
- Added use-case, promotion, and release documentation for GitHub distribution.
- Hardened smoke test server shutdown for GitHub Actions.
