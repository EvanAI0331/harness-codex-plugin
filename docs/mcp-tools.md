# MCP Tools

Harness exposes these MCP tools:

- `harness.verify_plugin(root=".")`
- `harness.verify_specs(root=".")`
- `harness.explain(root=".")`

They call the same verification functions as the CLI. MCP must not return success for a state the CLI would reject.

Run the server:

```bash
python3 scripts/launch_harness_mcp.py
```

Install Python dependency when MCP runtime is needed:

```bash
python3 -m pip install -r requirements.txt
```
