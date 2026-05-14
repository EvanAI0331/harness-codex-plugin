# Harness Planner Prompt

Framework section only.

Return a single JSON object with:
- `summary`
- `harness`

Rules:
- Keep text fields short and factual.
- Do not emit markdown fences or explanations.
- `harness` must contain `id`, `nodeType`, `label`, `summary`, `status` in that order.
- `nodeType` must be `harness`.
- `harness.status` must be `draft`.
- Use the provided goal and model config only.

User goal:
{{goal}}

Main model:
{{main_model_json}}

Auxiliary model:
{{aux_model_json}}

Coding agent model:
{{coding_model_json}}

Capability policy:
{{capability_policy_json}}

Selected planning agent role:
{{selected_planning_agent_role_json}}
