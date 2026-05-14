# Harness Task Instance Planner

Final deliverable segment only.

Return a single JSON object with:
- `finalDeliverable`

Rules:
- Select exactly one responsible agent from the assignments provided below.
- The final deliverable must be the task product itself, not the final summary report.
- `artifactType` must be `final.deliverable`.
- `format` must describe the exact delivery form, such as `structured JSON + Chinese summary`.
- `requiredFields` must list the fields that the responsible agent must include in the deliverable artifact.
- `summary` must be short and factual.
- `ownerAgentId` must match one of the `agentId` values in `Assignments`.
- `ownerAgentRole` must exactly match that assignment's `agentRole`.
- Do not leave any required field empty or null.
- Do not invent a new agent.
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

Goal draft:
{{stage_result_json}}

Criteria draft:
{{criteria_draft_json}}

Assignments:
{{assignments_json}}

Return only JSON.
