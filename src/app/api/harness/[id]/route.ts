import { NextResponse } from "next/server";
import { getHarnessById, saveHarness } from "@/lib/harness-repository";
import { markHarnessDirty } from "@/lib/harness-machine";
import type { BlueprintSpec, CapabilityNode, CapabilitySource, CapabilityStatus, Harness } from "shared/types";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const harness = getHarnessById(id);

  if (!harness) {
    return NextResponse.json({ error: "Harness not found." }, { status: 404 });
  }

  return NextResponse.json(harness);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const harness = getHarnessById(id);

  if (!harness) {
    return NextResponse.json({ error: "Harness not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isNodePatchRequest(body)) {
    return NextResponse.json({ error: "Invalid node patch request.", code: "invalid_patch" }, { status: 422 });
  }

  const patchResult = applyNodePatch(harness, body);
  if (!patchResult.ok) {
    return NextResponse.json(patchResult.body, { status: patchResult.status });
  }
  const updated = saveHarness(markHarnessDirty(patchResult.harness));
  return NextResponse.json(updated);
}

function isNodePatchRequest(value: unknown): value is {
  kind: "agent" | "spec" | "capability";
  nodeId: string;
  patch: Record<string, unknown>;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as { kind?: unknown }).kind === "agent" ||
        (value as { kind?: unknown }).kind === "spec" ||
        (value as { kind?: unknown }).kind === "capability") &&
      typeof (value as { nodeId?: unknown }).nodeId === "string" &&
      typeof (value as { patch?: unknown }).patch === "object" &&
      (value as { patch?: unknown }).patch !== null &&
      !Array.isArray((value as { patch?: unknown }).patch),
  );
}

function applyNodePatch(
  harness: Harness,
  request: { kind: "agent" | "spec" | "capability"; nodeId: string; patch: Record<string, unknown> },
): { ok: true; harness: Harness } | { ok: false; status: number; body: Record<string, unknown> } {
  const updatedAt = new Date().toISOString();
  const allowed = allowedPatchFields(request.kind);
  for (const key of Object.keys(request.patch)) {
    if (!allowed.has(key)) {
      return { ok: false, status: 422, body: { error: "Invalid patch field", code: "invalid_patch_field", nodeId: request.nodeId, detail: key } };
    }
  }

  if (request.kind === "agent") {
    const existing = harness.agentNodes.find((agent) => agent.id === request.nodeId);
    if (!existing) {
      return { ok: false, status: 404, body: { error: "Node not found", nodeId: request.nodeId } };
    }
    const nextCapabilityIds = stringArrayOr(existing.capabilityIds, request.patch.capabilityIds);
    for (const capabilityId of nextCapabilityIds) {
      if (!harness.capabilityNodes.some((capability) => capability.id === capabilityId)) {
        return { ok: false, status: 400, body: { error: "Capability not found", capabilityId, nodeId: request.nodeId } };
      }
    }
    const nextAgents = harness.agentNodes.map((agent) =>
      agent.id === request.nodeId
        ? {
            ...agent,
            label: stringOr(agent.label, request.patch.label),
            role: stringOr(agent.role, request.patch.role),
            model: {
              ...agent.model,
              provider: stringOr(agent.model.provider, request.patch.modelProvider),
              model: stringOr(agent.model.model, request.patch.modelName),
              baseURL: stringOrMaybe(agent.model.baseURL, request.patch.modelBaseURL),
              credentialRef: stringOrMaybe(agent.model.credentialRef, request.patch.modelCredentialRef),
              temperature: numberOr(agent.model.temperature, request.patch.modelTemperature),
              maxTokens: integerOr(agent.model.maxTokens, request.patch.modelMaxTokens),
            },
            capabilityIds: nextCapabilityIds,
            updatedAt,
          }
        : agent,
    );
    return { ok: true, harness: {
      ...harness,
      name: harness.name,
      agentNodes: nextAgents,
      blueprint: harness.blueprint
        ? {
            ...harness.blueprint,
            agents: nextAgents,
          }
        : harness.blueprint,
      updatedAt,
    } };
  }

  if (request.kind === "spec") {
    if (!harness.blueprint?.specs.some((spec) => spec.id === request.nodeId)) {
      return { ok: false, status: 404, body: { error: "Node not found", nodeId: request.nodeId } };
    }
    const nextSpecs = harness.blueprint?.specs.map((spec): BlueprintSpec =>
      spec.id === request.nodeId
        ? {
            ...spec,
            title: stringOr(spec.title, request.patch.title),
            summary: stringOr(spec.summary, request.patch.summary),
            compiledPath: stringOrMaybe(spec.compiledPath, request.patch.compiledPath),
            stdout: stringOrMaybe(spec.stdout, request.patch.stdout),
            stderr: stringOrMaybe(spec.stderr, request.patch.stderr),
            compileStatus: compileStatusOr(spec.compileStatus, request.patch.compileStatus),
          }
        : spec,
    );
    return { ok: true, harness: {
      ...harness,
      blueprint: harness.blueprint && nextSpecs
        ? {
            ...harness.blueprint,
            specs: nextSpecs,
          }
        : harness.blueprint,
      updatedAt,
    } };
  }

  if (!harness.capabilityNodes.some((capability) => capability.id === request.nodeId)) {
    return { ok: false, status: 404, body: { error: "Node not found", nodeId: request.nodeId } };
  }
  const nextCapabilities = harness.capabilityNodes.map((capability): CapabilityNode =>
    capability.id === request.nodeId
      ? {
          ...capability,
          label: stringOr(capability.label, request.patch.label),
          summary: stringOr(capability.summary, request.patch.summary),
          source: capabilitySourceOr(capability.source, request.patch.source),
          status: capabilityStatusOr(capability.status, request.patch.status),
          registryKey: stringOrMaybe(capability.registryKey, request.patch.registryKey),
          resolverName: stringOrMaybe(capability.resolverName, request.patch.resolverName),
          policyFlags: capabilityPolicyOr(capability.policyFlags, request.patch.policyFlags),
          specArtifactIds: stringArrayOr(capability.specArtifactIds, request.patch.specArtifactIds),
          updatedAt,
        }
      : capability,
  );
  return { ok: true, harness: {
    ...harness,
    capabilityNodes: nextCapabilities,
    blueprint: harness.blueprint
      ? {
          ...harness.blueprint,
          capabilities: nextCapabilities,
        }
      : harness.blueprint,
    updatedAt,
  } };
}

function allowedPatchFields(kind: "agent" | "spec" | "capability"): Set<string> {
  if (kind === "agent") {
    return new Set(["label", "role", "modelProvider", "modelName", "modelBaseURL", "modelCredentialRef", "modelTemperature", "modelMaxTokens", "capabilityIds"]);
  }
  if (kind === "spec") {
    return new Set(["title", "summary", "compiledPath", "stdout", "stderr", "compileStatus"]);
  }
  return new Set(["label", "summary", "source", "status", "registryKey", "resolverName", "policyFlags", "specArtifactIds"]);
}

function stringOr(current: string, next: unknown): string {
  return typeof next === "string" && next.trim().length > 0 ? next : current;
}

function stringOrMaybe(current: string | undefined, next: unknown): string | undefined {
  if (typeof next === "string" && next.trim().length > 0) {
    return next;
  }
  return current;
}

function stringArrayOr(current: string[], next: unknown): string[] {
  if (Array.isArray(next)) {
    const values = next.map((item) => String(item).trim()).filter((item) => item.length > 0);
    return values.length > 0 ? values : current;
  }

  if (typeof next === "string") {
    const values = next
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return values.length > 0 ? values : current;
  }

  return current;
}

function numberOr(current: number, next: unknown): number {
  if (typeof next === "number" && Number.isFinite(next)) {
    return next;
  }
  if (typeof next === "string" && next.trim().length > 0) {
    const parsed = Number(next);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return current;
}

function integerOr(current: number, next: unknown): number {
  const value = numberOr(current, next);
  return Number.isInteger(value) ? value : current;
}

function compileStatusOr(
  current: BlueprintSpec["compileStatus"],
  next: unknown,
): BlueprintSpec["compileStatus"] {
  if (next === "pending" || next === "success" || next === "failure") {
    return next;
  }
  return current;
}

function capabilitySourceOr(current: CapabilitySource, next: unknown): CapabilitySource {
  if (next === "builtin" || next === "local" || next === "github" || next === "generated" || next === "unresolved") {
    return next;
  }
  return current;
}

function capabilityStatusOr(
  current: CapabilityStatus,
  next: unknown,
): CapabilityStatus {
  if (next === "unresolved" || next === "resolved" || next === "missing" || next === "ready" || next === "blocked" || next === "failed") {
    return next;
  }
  return current;
}

function capabilityPolicyOr(
  current: { allowGithubSearch: boolean; allowAutoGenerateSkill: boolean; allowAutoGenerateScript: boolean },
  next: unknown,
): { allowGithubSearch: boolean; allowAutoGenerateSkill: boolean; allowAutoGenerateScript: boolean } {
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    return current;
  }

  const candidate = next as Partial<typeof current>;
  return {
    allowGithubSearch: typeof candidate.allowGithubSearch === "boolean" ? candidate.allowGithubSearch : current.allowGithubSearch,
    allowAutoGenerateSkill:
      typeof candidate.allowAutoGenerateSkill === "boolean" ? candidate.allowAutoGenerateSkill : current.allowAutoGenerateSkill,
    allowAutoGenerateScript:
      typeof candidate.allowAutoGenerateScript === "boolean" ? candidate.allowAutoGenerateScript : current.allowAutoGenerateScript,
  };
}
