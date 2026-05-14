# Harness Planner Prompt

Spec settings section only.

Return a single JSON object with:
- `specs`

Rules:
- Emit exactly one spec node per selected agent in exact execution order.
- The agents input already reflects the dispatcher-selected planning agent and the planning-agent-selected expert agents.
- Each `agentId` must match the canonical agent ids exactly.
- Each spec must include a non-empty `artifactId`.
- Use a stable slug-like `artifactId` derived from the agent identity and role, such as `spec.<agent-id>.contract`.
- Each spec object must include these fields in order:
  `id`, `nodeType`, `specType`, `agentId`, `title`, `summary`, `artifactId`, `specArtifactIds`, `compileStatus`, `compiledPath`, `stdout`, `stderr`.
- `nodeType` must be `spec`.
- `specType` must be `agent`.
- Keep titles and summaries short.
- Each spec must reference its agent by `agentId`.
- `compileStatus` can be `pending`.
- `specArtifactIds` can be an empty array.
- This section runs independently from agent generation and must preserve the planner's canonical agent execution order.
- Keep the spec order fixed to the planner's canonical agent execution order.
- Do not emit markdown fences or explanations.

Framework summary:
{{framework_json}}

Agents:
{{agents_json}}

Selected planning agent role:
{{selected_planning_agent_role_json}}

User goal:
{{goal}}

Canonical agent roles:
{{canonical_agent_ids_json}}

Agent catalog:
{{agent_catalog_json}}
