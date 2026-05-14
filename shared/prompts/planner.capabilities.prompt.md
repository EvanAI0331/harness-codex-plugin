# Harness Planner Prompt

Capability section only.

Return a single JSON object with:
- `capabilities`

Rules:
- Double-quote every key.
- Emit exactly 1 capability:
  1. tool capability for skill/tool/library lookup via GitHub only
- Each capability object must include these fields in this exact order:
  `id`, `nodeType`, `label`, `summary`, `capabilityType`, `source`, `status`, `specArtifactIds`, `policyFlags`, `createdAt`, `updatedAt`.
- `nodeType` must be `capability`.
- `capabilityType` must be `tool`, `skill`, or `script`.
- `source` must be `builtin`, `local`, `github`, `generated`, or `unresolved`.
- `status` must be `unresolved`, `resolved`, `missing`, `ready`, `blocked`, or `failed`.
- Keep `label` and `summary` short and factual.
- Prefer the smallest capability set needed for the goal.
- `specArtifactIds` must be an empty array unless the capability is backed by a spec artifact.
- `policyFlags` is mandatory and must be copied exactly from the provided capability policy.
- `policyFlags` must contain all three boolean keys in this exact shape:
  `"policyFlags": {
    "allowGithubSearch": true,
    "allowAutoGenerateSkill": true,
    "allowAutoGenerateScript": true
  }`
- `allowGithubSearch` only permits GitHub lookup for skills, tools, libraries, or direct repository references.
- Never use GitHub search for general information search or research.
- Never omit `policyFlags`, even when all three values are the same.
- Do not include `registryKey`, `resolutionReason`, or `resolverName`.
- `createdAt` and `updatedAt` must be ISO timestamps.
- Do not emit markdown fences or explanations.
- Do not include edges in this section.

Framework summary:
{{framework_json}}

User goal:
{{goal}}

Capability policy:
{{capability_policy_json}}

Selected planning agent role:
{{selected_planning_agent_role_json}}
