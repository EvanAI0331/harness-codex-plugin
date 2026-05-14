# Use Cases

Harness is built for Codex workflows that need repeatable structure instead of freestyle execution.

## Software Delivery

Turn a product or engineering workflow into a graph of role-bound agents, capability nodes, artifacts, and final deliverables.

Start from:

```bash
python3 scripts/harness_cli.py init-workflow --template software_delivery --output ./harness.workflow.json
python3 scripts/harness_cli.py verify-workflow ./harness.workflow.json
```

Best fit:

- Repository audits
- Refactor workflows
- QA and release checks
- Documentation pipelines

## Research and Operations

Use Harness when a workflow needs separate planning, execution, evidence collection, and final report assembly.

Start from:

```bash
python3 scripts/harness_cli.py init-workflow --template research_ops --output ./harness.workflow.json
python3 scripts/harness_cli.py verify-workflow ./harness.workflow.json
```

Best fit:

- Market research
- Competitive scans
- Content production pipelines
- Business process automation

## Multi-Agent Frameworks

Harness keeps multi-agent systems inspectable. Every real agent needs role, execution, and output specs. Script-only utilities remain tools.

Best fit:

- Custom workflow products
- Internal agent workbenches
- Agent runtime experiments
- Spec-bound task execution
