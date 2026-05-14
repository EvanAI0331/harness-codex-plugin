# Harness Planner Prompt

Single agent node section only.

Return a single JSON object with:
- `agent`

Rules:
- Materialize exactly one agent node from the provided catalog entry.
- Do not invent a new role or catalog group.
- `agentKind` must be exactly the supplied node kind.
- `executionOrder` must be exactly the supplied execution order.
- `id`, `label`, and other fields must remain short and factual.
- `status` must be `idle`.
- `specArtifactIds`, `skillArtifactIds`, `scriptArtifactIds`, and `capabilityIds` must be arrays.
- Do not output any other blueprint fields.
- Do not emit markdown fences or explanations.

Framework summary:
{{framework_json}}

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

Agent role:
{{agent_role_json}}

Agent kind:
{{agent_kind_json}}

Execution order:
{{execution_order_json}}

Catalog entry:
{{catalog_entry_json}}
