---
name: harness-plugin-packager
description: Package Harness as a Codex plugin and verify distribution metadata.
---

# Harness Plugin Packager

Use this skill before distributing Harness as a Codex plugin.

Checklist:
- `.codex-plugin/plugin.json` exists and its `name` matches the plugin folder.
- `skills/` contains concrete Codex skills.
- `.mcp.json` points only to MCP servers that are implemented and testable.
- `.agents/plugins/marketplace.json` exists for repo-backed marketplace distribution.
- README documents GitHub-backed distribution and does not claim official directory publishing.
- Clean packages exclude generated state: `.next`, `node_modules`, `data`, `tmp`, zip files, caches, and build artifacts.

Fail if any required packaging metadata is missing.
