# Contributing

Thanks for helping improve Harness Studio.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

For the demo flow:

```bash
npm run demo
```

## Before You Send a PR

- Run `npm run typecheck`
- Run `npm run test:smoke`
- Make sure the workspace still opens, builds, and runs

## Code Style

- Keep changes minimal and focused
- Do not introduce mock-only success paths
- Do not bypass workflow logic with hardcoded outputs
- Prefer adapter boundaries over direct coupling
- Keep user-facing copy honest about current capability

## Issues

When filing an issue, include:

- what you tried
- what you expected
- what happened instead
- whether `DEMO_MODE` was enabled
- the relevant provider / credentialRef settings

## Pull Requests

Please include:

- a short summary
- the files you changed
- test results
- whether docs, env, or smoke behavior changed

## Scope

This repository is an OSS harness runtime and workbench. If your change requires a new integration, keep it behind an adapter boundary when possible.
