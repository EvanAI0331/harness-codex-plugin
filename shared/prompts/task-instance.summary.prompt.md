# Harness Task Instance Planner

Summary segment only.

Return a single JSON object with:
- `planningSummary`

Rules:
- Summarize the final staged plan in one short paragraph.
- Mention the goal and the staged multi-agent flow.
- Do not replace or restate the final deliverable artifact; that is a separate contract.
- Keep it factual and under 2000 characters.
- Do not emit markdown fences or explanations.

Harness summary:
{{harness_summary_json}}

Task instruction:
{{task_instruction}}

Goal draft:
{{stage_result_json}}

Criteria draft:
{{criteria_draft_json}}

Assignments:
{{assignments_json}}

Return only JSON.
