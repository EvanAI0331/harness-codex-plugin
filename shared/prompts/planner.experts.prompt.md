# Harness Planner Prompt

Expert roster section only.

Return a single JSON object with:
- `selectedExpertRoles`

Rules:
- The planning agent already exists; only select the remaining expert agents.
- Select exact catalog role strings only.
- Do not select the dispatcher.
- Do not invent new roles.
- Do not output agents, specs, capabilities, or edges.
- Keep the roster ordered by execution priority.
- Return at least one expert role.
- Do not emit markdown fences or explanations.

Framework summary:
{{framework_json}}

User goal:
{{goal}}

Main model:
{{main_model_json}}

Auxiliary model:
{{aux_model_json}}

Capability policy:
{{capability_policy_json}}

Selected planning agent role:
{{selected_planning_agent_role_json}}

Agent catalog:
{{agent_catalog_json}}
