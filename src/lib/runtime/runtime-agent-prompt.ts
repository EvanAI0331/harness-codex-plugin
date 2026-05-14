import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.join(MODULE_DIR, "../../../shared/prompts/runtime-agent.prompt.md");

export function renderRuntimeAgentPrompt(args: {
  runtimeAgentSpecJson: string;
  runtimeAgentSchemaJson: string;
  taskInstanceJson: string;
  agentSpecJson: string;
  outputContractJson: string;
  upstreamArtifactsJson: string;
  availableCapabilitiesJson: string;
  runPolicyJson: string;
  taskInstruction: string;
}): string {
  return fs
    .readFileSync(promptPath, "utf8")
    .replace("{{runtime_agent_spec_json}}", args.runtimeAgentSpecJson)
    .replace("{{runtime_agent_schema_json}}", args.runtimeAgentSchemaJson)
    .replace("{{task_instance_json}}", args.taskInstanceJson)
    .replace("{{agent_spec_json}}", args.agentSpecJson)
    .replace("{{output_contract_json}}", args.outputContractJson)
    .replace("{{upstream_artifacts_json}}", args.upstreamArtifactsJson)
    .replace("{{available_capabilities_json}}", args.availableCapabilitiesJson)
    .replace("{{run_policy_json}}", args.runPolicyJson)
    .replace("{{task_instruction}}", args.taskInstruction);
}
