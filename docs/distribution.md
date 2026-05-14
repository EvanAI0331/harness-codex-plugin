# Distribution

Official Codex Plugin Directory publishing is not yet self-serve.
Harness is currently distributed through a GitHub-backed Codex marketplace.

Standard install command:

```bash
codex plugin marketplace add https://github.com/EvanAI0331/harness-codex-marketplace.git --ref v0.1.8
```

Repo marketplace layout:

```text
.agents/plugins/marketplace.json
plugins/harness-codex-plugin/
```

Before publishing:

```bash
npm run plugin:verify
npm run plugin:verify-specs
npm run typecheck
npm run test:smoke
```
