import Ajv from "ajv/dist/2020";
import type {
  ScriptAuthoringAdapter,
  ScriptAuthoringGenerationResponse,
  ScriptAuthoringRepairRequest,
  ScriptAuthoringRequest,
} from "@/lib/scriptx/types";
import { renderScriptAuthoringPrompt } from "@/lib/scriptx/prompt";
import { loadScriptAuthoringSchemaObject } from "@/lib/scriptx/schema";
import { loadScriptAuthoringManifest, loadScriptAuthoringRoleSpec, loadScriptAuthoringExecutionSpec, loadScriptAuthoringOutputSpec } from "@/lib/scriptx/spec";
import type { LLMAdapter } from "@/lib/llm/types";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(loadScriptAuthoringSchemaObject() as object);
const SCRIPT_AUTHORING_MIN_MAX_TOKENS = 8192;

export class LLMScriptAuthoringAdapter implements ScriptAuthoringAdapter {
  constructor(private readonly llm: LLMAdapter) {}

  async generate(request: ScriptAuthoringRequest & { model: import("shared/types").ModelConfig }): Promise<ScriptAuthoringGenerationResponse> {
    return this.generateInternal(request, undefined);
  }

  async repair(request: ScriptAuthoringRepairRequest): Promise<ScriptAuthoringGenerationResponse> {
    return this.generateInternal(
      request,
      {
        failedKind: request.failedKind,
        compilerError: request.compilerError,
        failingSource: request.failingSource,
        failedPlan: request.failedPlan,
      },
    );
  }

  private async generateInternal(
    request: ScriptAuthoringRequest & { model: import("shared/types").ModelConfig },
    repairContext:
      | {
          failedKind: "skill" | "script";
          compilerError: string;
          failingSource: string;
          failedPlan: ScriptAuthoringRepairRequest["failedPlan"];
        }
      | undefined,
  ): Promise<ScriptAuthoringGenerationResponse> {
    const specJson = JSON.stringify(
      {
        manifest: JSON.parse(loadScriptAuthoringManifest()) as unknown,
        role: JSON.parse(loadScriptAuthoringRoleSpec()) as unknown,
        execution: JSON.parse(loadScriptAuthoringExecutionSpec()) as unknown,
        output: JSON.parse(loadScriptAuthoringOutputSpec()) as unknown,
      },
      null,
      2,
    );
    const schemaJson = JSON.stringify(loadScriptAuthoringSchemaObject(), null, 2);
    const prompt = renderScriptAuthoringPrompt({
      harness: request.harness,
      agent: request.agent,
      binding: request.binding,
      scriptAuthoringSpecJson: specJson,
      scriptAuthoringSchemaJson: schemaJson,
    });

    const systemPrompt = repairContext
      ? [
          prompt,
          "",
          "Repair mode:",
          "- Fix only the syntax, escaping, or structural problem that caused compilation to fail.",
          "- Preserve the original intent and output schema.",
          "- Return a full valid JSON object that matches the schema.",
          `Failed section: ${repairContext.failedKind}`,
          "Compiler error:",
          repairContext.compilerError,
          "Failing source:",
          repairContext.failingSource,
          "Previous plan:",
          JSON.stringify(repairContext.failedPlan, null, 2),
        ].join("\n")
      : prompt;

    const response = await this.llm.generateJson({
      config: {
        ...request.model,
        maxTokens: Math.max(request.model.maxTokens, SCRIPT_AUTHORING_MIN_MAX_TOKENS),
      },
      systemPrompt,
      userPrompt: JSON.stringify(
        {
          harnessId: request.harness.id,
          agentId: request.agent.id,
          agentRole: request.agent.role,
          binding: request.binding,
          codingModel: request.model,
          repair: Boolean(repairContext),
        },
        null,
        2,
      ),
      schemaName: "ScriptAuthoringOutput",
    });

    let parsed: ScriptAuthoringGenerationResponse["plan"];
    try {
      parsed = JSON.parse(response.rawText) as ScriptAuthoringGenerationResponse["plan"];
    } catch (error) {
      const repaired = await this.repairInvalidJsonResponse({
        request,
        repairContext,
        rawText: response.rawText,
        parseError: error instanceof Error ? error.message : String(error),
      });
      try {
        parsed = JSON.parse(repaired.rawText) as ScriptAuthoringGenerationResponse["plan"];
      } catch (retryError) {
        throw new Error(
          `Script authoring returned invalid JSON: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
      }
      if (!validate(parsed)) {
        throw new Error(`Script authoring schema validation failed: ${(validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message || "invalid"}`).join("; ")}`);
      }
      return {
        plan: parsed,
        rawText: repaired.rawText,
        rawPayload: repaired.rawPayload,
        model: repaired.model,
        provider: repaired.provider,
      };
    }
    if (!validate(parsed)) {
      throw new Error(`Script authoring schema validation failed: ${(validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message || "invalid"}`).join("; ")}`);
    }
    return {
      plan: parsed,
      rawText: response.rawText,
      rawPayload: response.rawPayload,
      model: response.model,
      provider: response.provider,
    };
  }

  private async repairInvalidJsonResponse(args: {
    request: {
      harness: import("shared/types").Harness;
      agent: import("shared/types").AgentNode;
      binding: import("shared/types").RuntimeContractBinding;
      model: import("shared/types").ModelConfig;
    };
    repairContext:
      | {
          failedKind: "skill" | "script";
          compilerError: string;
          failingSource: string;
          failedPlan: ScriptAuthoringGenerationResponse["plan"];
        }
      | undefined;
    rawText: string;
    parseError: string;
  }): Promise<import("@/lib/llm/types").LLMJsonResponse> {
    const { request, repairContext, rawText, parseError } = args;
    const specJson = JSON.stringify(
      {
        manifest: JSON.parse(loadScriptAuthoringManifest()) as unknown,
        role: JSON.parse(loadScriptAuthoringRoleSpec()) as unknown,
        execution: JSON.parse(loadScriptAuthoringExecutionSpec()) as unknown,
        output: JSON.parse(loadScriptAuthoringOutputSpec()) as unknown,
      },
      null,
      2,
    );
    const schemaJson = JSON.stringify(loadScriptAuthoringSchemaObject(), null, 2);
    const prompt = renderScriptAuthoringPrompt({
      harness: request.harness,
      agent: request.agent,
      binding: request.binding,
      scriptAuthoringSpecJson: specJson,
      scriptAuthoringSchemaJson: schemaJson,
    });

    const systemPrompt = [
      prompt,
      "",
      "Repair mode:",
      "- The previous response was invalid JSON.",
      "- Return exactly one JSON object that matches the schema.",
      "- Do not add markdown fences or prose.",
      "- Keep the output concise and structurally valid.",
      `Parse error: ${parseError}`,
      "Previous raw response:",
      rawText,
    ];

    if (repairContext) {
      systemPrompt.push(
        "",
        "Additional repair context:",
        `Failed section: ${repairContext.failedKind}`,
        `Compiler error: ${repairContext.compilerError}`,
        `Failing source: ${repairContext.failingSource}`,
        "Previous plan:",
        JSON.stringify(repairContext.failedPlan, null, 2),
      );
    }

    return this.llm.generateJson({
      config: {
        ...request.model,
        maxTokens: Math.max(request.model.maxTokens, SCRIPT_AUTHORING_MIN_MAX_TOKENS),
      },
      systemPrompt: systemPrompt.join("\n"),
      userPrompt: JSON.stringify(
        {
          harnessId: request.harness.id,
          agentId: request.agent.id,
          agentRole: request.agent.role,
          binding: request.binding,
          codingModel: request.model,
          repair: true,
          parseError,
        },
        null,
        2,
      ),
      schemaName: "ScriptAuthoringOutput",
    });
  }
}
