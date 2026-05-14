# Harness Task Instance Planner

Criteria segment only.

Return a single JSON object with:
- `constraints`
- `successCriteria`

Rules:
- Use the normalized goal draft provided below.
- Constraints must include the run policy limits and the harness capability boundaries.
- Success criteria must be concrete, testable, and aligned with the actual harness agent roster.
- Do not output goal, per-agent assignments, or planning summary in this segment.
- Do not invent agents or capabilities.
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

Goal draft:
{{stage_result_json}}

Return only JSON.
