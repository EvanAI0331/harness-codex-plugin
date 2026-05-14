---
name: harness-workflow-builder
description: Build custom workflow harnesses with role, execution, and output specs.
---

# Harness Workflow Builder

Use this skill when the user wants to turn a workflow idea into a structured Harness runtime.

Rules:
- Build workflow first: intake, graph, role specs, execution specs, output specs, capabilities, gates, artifacts.
- Do not call a script-only component an agent.
- Agent behavior must be LLM-driven through the runtime adapter and bounded by specs.
- If a required spec compiler or generator is unavailable, stop and report `failure_state=missing_spec_compiler`.
- Do not hardcode fallback agents, fallback outputs, or success states.
- Keep every workflow decision tied to evidence, an artifact, or a gate.

Expected output:
- Harness goal.
- Agent list with role/execution/output specs.
- Capability registry requirements.
- Runtime gates.
- Expected artifacts.
- Failure semantics.
