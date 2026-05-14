# Harness Planner Prompt

Edge section only.

Return a single JSON object with:
- `edges`

Rules:
- Double-quote every key.
- Emit 1 to 12 edges.
- Each edge object must include these fields in this exact order:
  `id`, `source`, `target`, `relation`.
- `source` and `target` must use the canonical harness and agent ids exactly.
- `relation` must be one of:
  `contains`, `defines`, `delegates_to`, `feeds`, `depends_on`, `requires`, `missing`.
- Direction rules:
  - `contains`: `source` is the harness root, `target` is the agent.
  - `defines`: `source` is the agent, `target` is the spec node.
  - `delegates_to`: `source` is the harness root, `target` is the entry agent.
  - `feeds`: `source` is the upstream stage, `target` is the downstream stage.
  - `depends_on`: `source` is the prerequisite/upstream node, `target` is the dependent/downstream node.
  - `requires`: `source` is the agent, `target` is the capability.
  - `missing`: `source` is the agent, `target` is the unresolved capability.
- Keep relations factual and minimal.
- Allowed relation: contains, defines, delegates_to, feeds, depends_on, requires, missing.
- Emit edges in canonical order:
  structure -> dependency -> resolution.
- Do not include `label`.
- Do not emit markdown fences or explanations.
- Do not include capabilities in this section.

Framework summary:
{{framework_json}}

Agents:
{{agents_json}}

User goal:
{{goal}}

Canonical agent ids:
{{canonical_agent_ids_json}}

Selected planning agent role:
{{selected_planning_agent_role_json}}
