# Harness Task Instance Planner

Assignment segment only.

Return a single JSON object with:
- `objective`
- `expectedArtifacts`
- `capabilityFocus`

Rules:
- Plan only the current agent.
- Use the goal draft, criteria draft, and this agent summary.
- You must choose at least one capability from the available capability list below.
- `objective` must be specific to this agent and the current run.
- `expectedArtifacts` must list the concrete artifacts this agent should produce.
- `capabilityFocus` must only use capabilities actually available to this agent.
- Do not invent agents or capabilities.
- Keep the JSON compact and strictly valid.
- Do not emit markdown fences or explanations.

Harness summary:
{{harness_summary_json}}

Run policy:
{{run_policy_json}}

Task instruction:
{{task_instruction}}

Goal draft:
{{stage_result_json}}

Criteria draft:
{{criteria_draft_json}}

Current agent:
{{agent_summary_json}}

Available capabilities:
{{available_capabilities_json}}

Prior assignments:
{{prior_assignments_json}}

Failure reason to fix if present:
{{failure_reason_json}}

Return only JSON.
