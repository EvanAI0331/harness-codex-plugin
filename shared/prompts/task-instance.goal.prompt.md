# Harness Task Instance Planner

Goal segment only.

Return a single JSON object with:
- `goal`

Rules:
- Normalize the user task into a run goal grounded in the harness blueprint.
- Do not output constraints, success criteria, per-agent assignments, or planning summary in this segment.
- Do not invent agents, capabilities, or unsupported constraints.
- Keep the JSON compact and strictly valid.
- Do not emit markdown fences or explanations.

Harness summary:
{{harness_summary_json}}

Blueprint summary:
{{blueprint_summary_json}}

Run policy:
{{run_policy_json}}

Run parameters:
{{run_parameters_json}}

Task instruction:
{{task_instruction}}

Return only JSON.
