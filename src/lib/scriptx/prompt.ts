import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentNode, Harness, RuntimeContractBinding } from "shared/types";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.join(MODULE_DIR, "../../../shared/prompts/script-authoring.prompt.md");

export function loadScriptAuthoringPromptTemplate(): string {
  return fs.readFileSync(promptPath, "utf8");
}

export function renderScriptAuthoringPrompt(args: {
  harness: Harness;
  agent: AgentNode;
  binding: RuntimeContractBinding;
  scriptAuthoringSpecJson: string;
  scriptAuthoringSchemaJson: string;
}): string {
  const harnessContext = {
    id: args.harness.id,
    name: args.harness.name,
    status: args.harness.status,
    goal: args.harness.intake.goal,
    summary: args.harness.blueprint?.summary ?? "",
    mainModel: args.harness.intake.mainModel,
    auxiliaryModel: args.harness.intake.auxiliaryModel,
    codingAgentModel: args.harness.intake.codingAgentModel,
    capabilityPolicy: args.harness.intake.capabilityPolicy,
    agentCount: args.harness.agentNodes.length,
    capabilityCount: args.harness.capabilityNodes.length,
    specArtifactCount: args.harness.specArtifacts.length,
  };
  const agentContext = {
    id: args.agent.id,
    label: args.agent.label,
    role: args.agent.role,
    model: args.agent.model,
    status: args.agent.status,
    capabilityIds: args.agent.capabilityIds,
    specArtifactIds: args.agent.specArtifactIds,
    skillArtifactIds: args.agent.skillArtifactIds,
    scriptArtifactIds: args.agent.scriptArtifactIds,
  };
  const bindingContext = {
    contractArtifactId: args.binding.contractArtifactId,
    sourceArtifactId: args.binding.sourceArtifactId,
    compiledArtifactId: args.binding.compiledArtifactId,
    backtestArtifactId: args.binding.backtestArtifactId,
    contractVersion: args.binding.contractVersion,
    entry: args.binding.entry,
    dependencyIds: args.binding.dependencyIds,
    requiredCapabilities: args.binding.requiredCapabilities,
    requiredArtifacts: args.binding.requiredArtifacts,
    outputFields: args.binding.outputFields,
    runtimeOrder: args.binding.runtimeOrder,
    backtestStatus: args.binding.backtestStatus,
  };

  return loadScriptAuthoringPromptTemplate()
    .replace("{{script_authoring_spec_json}}", args.scriptAuthoringSpecJson)
    .replace("{{script_authoring_schema_json}}", args.scriptAuthoringSchemaJson)
    .replace("{{harness_json}}", JSON.stringify(harnessContext, null, 2))
    .replace("{{agent_json}}", JSON.stringify(agentContext, null, 2))
    .replace("{{contract_json}}", JSON.stringify(bindingContext, null, 2));
}
