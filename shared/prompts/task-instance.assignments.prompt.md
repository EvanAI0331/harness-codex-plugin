# Harness Task Instance Planner

Assignments segment only.

Return a single JSON object with:
- `perAgentAssignments`
- `planningSummary`

Rules:
- Use the goal, constraints, and success criteria draft provided below.
- Align every assignment to an actual harness agent.
- Each assignment must include `agentId`, `agentRole`, `objective`, `expectedArtifacts`, `dependencies`, and `capabilityFocus`.
- `expectedArtifacts` must describe the concrete artifacts that agent should produce.
- Do not invent agents or capabilities.
- The planning summary must be short, factual, and describe the staged run plan.
- Do not output goal, constraints, or success criteria in this segment.
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

Goal and criteria draft:
{{stage_result_json}}

Return only JSON.
