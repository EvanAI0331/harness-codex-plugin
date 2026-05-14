# Harness Planner Prompt

Dispatcher section only.

Return a single JSON object with:
- `summary`
- `selectedPlanningAgentRole`

Rules:
- Only choose one planning expert from the catalog.
- Do not output capabilities, specs, edges, or other blueprint fields.
- Do not hardcode the number of agents.
- The dispatcher only selects the single planning agent.
- The dispatcher also acts as the segmenting controller: it must think in downstream segments and keep the planning flow consumable stage by stage.
- `selectedPlanningAgentRole` must be an exact catalog role string.
- Keep `summary` short and factual.
- Do not emit markdown fences or explanations.

User goal:
{{goal}}

Capability policy:
{{capability_policy_json}}

Agent catalog:
{{agent_catalog_json}}
