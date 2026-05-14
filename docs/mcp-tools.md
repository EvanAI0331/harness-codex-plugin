# MCP Tools

Harness exposes these MCP tools:

- `harness.verify_plugin(root=".")`
- `harness.verify_specs(root=".")`
- `harness.list_workflow_templates(root=".")`
- `harness.init_workflow(template, output=None, root=".")`
- `harness.verify_workflow(path)`
- `harness.explain(root=".")`

They call the same verification functions as the CLI. MCP must not return success for a state the CLI would reject.

`harness.init_workflow` creates execution-before contracts only. It must not return an execution result, pass state, or generated deliverable. `harness.verify_workflow` fails closed when required gates, LLM-driven role specs, artifacts, failure semantics, or execution checks are missing.

Run the server:

```bash
python3 scripts/launch_harness_mcp.py
```

Install Python dependency when MCP runtime is needed:

```bash
python3 -m pip install -r requirements.txt
```
