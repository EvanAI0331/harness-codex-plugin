import Ajv from "ajv/dist/2020";
import type { AgentNode, CapabilityPolicy, Harness, HarnessBlueprint, RuntimeContractBinding } from "shared/types";
import { hash16 } from "@/lib/specs/spec-hash";
import { loadSpecxContractSchemaObject, loadSpecxContractSpecObject } from "@/lib/specx/schema";

const ajv = new Ajv({ allErrors: true, strict: true });
const validateContractSchema = ajv.compile(loadSpecxContractSchemaObject() as object);

type ContractRecord = Record<string, unknown>;
type SpecxBacktestCase = { id: string; name: string; expected: "pass" | "fail" };
const REQUIRED_SPECX_ARTIFACTS = [
  "spec.contract.source",
  "role",
  "execution",
  "output",
  "spec.contract.compiled",
  "skill.source",
  "skill.compiled",
  "script.source",
  "script.compiled",
  "spec.contract.backtest",
];

const specxContractSpec = loadSpecxContractSpecObject() as {
  rootFieldOrder: string[];
  nodeFieldOrders: Record<string, string[]>;
  arrayOrders: {
    runtimeBinding: {
      requiredArtifacts: string[];
      outputFields: string[];
      dependencyIds: "source-first";
    };
    backtestCases: {
      order: string[];
    };
  };
  canonicalization: {
    strictRootOrder: boolean;
    strictNodeOrder: boolean;
    strictArrayOrder: boolean;
    rejectEmptyCollections: boolean;
    rejectUnknownFields: boolean;
  };
  minimums: {
    contractIdMinLength: number;
    specFamilyMinLength: number;
    specVersionMinLength: number;
    runtimeDependenciesMinItems: number;
    requiredCapabilitiesMinItems: number;
    requiredArtifactsMinItems: number;
    outputFieldsMinItems: number;
    backtestCasesMinItems: number;
  };
};

export interface SpecxContractGenerationIds {
  sourceArtifactId: string;
  compiledArtifactId: string;
  backtestArtifactId: string;
}

export interface SpecxContractSourcePayload {
  contractId: string;
  specFamily: "specx";
  specVersion: string;
  scope: "harness-agent";
  harness: {
    id: string;
    nodeType: "harness";
    label: string;
    summary: string;
    status: Harness["status"];
    goal: string;
    mainModel: Harness["intake"]["mainModel"];
    auxiliaryModel: Harness["intake"]["auxiliaryModel"];
    codingAgentModel: Harness["intake"]["codingAgentModel"];
    capabilityPolicy: CapabilityPolicy;
  };
  agent: {
    id: string;
    nodeType: "agent";
    label: string;
    role: string;
    model: Harness["intake"]["mainModel"];
    status: AgentNode["status"];
    capabilityIds: string[];
    dependencyIds: string[];
    specArtifactIds: string[];
    skillArtifactIds: string[];
    scriptArtifactIds: string[];
  };
  runtimeBinding: RuntimeContractBinding;
  outputContract: {
    artifactType: "agent.output";
    outputType: string;
    role: string;
    roleResponsibilities: string[];
    requiredFields: string[];
    contentFields: string[];
    qualityGates: string[];
  };
  validation: {
    requiredArtifacts: string[];
    requiredChecks: string[];
    runtimeGate: string;
    contractGate: string;
  };
  backtest: {
    cases: SpecxBacktestCase[];
    expectedFailureModes: string[];
  };
}

export interface AgentContractSource {
  payload: SpecxContractSourcePayload;
  sourceText: string;
  sourceHash: string;
}

export interface AgentContractBacktest {
  success: boolean;
  payload: string;
  stdout: string;
  stderr: string;
}

export function buildAgentContractSource(
  harness: Harness,
  blueprint: HarnessBlueprint,
  agent: AgentNode,
  runtimeOrder: number,
  ids: SpecxContractGenerationIds,
): AgentContractSource {
  const dependencyIds = resolveDependencyIds(blueprint, agent.id, harness.id);
  const requiredCapabilities = agent.capabilityIds.length > 0 ? [...agent.capabilityIds] : [agent.role];
  const roleOutput = buildRoleOutputContract(agent, harness);
  const contractId = `specx_contract_${hash16(`${harness.id}:${agent.id}:${agent.role}`)}`;
  const payload: SpecxContractSourcePayload = {
    contractId,
    specFamily: "specx",
    specVersion: "v1",
    scope: "harness-agent",
    harness: {
      id: harness.id,
      nodeType: "harness",
      label: harness.name,
      summary: blueprint.summary,
      status: harness.status,
      goal: harness.intake.goal,
      mainModel: harness.intake.mainModel,
      auxiliaryModel: harness.intake.auxiliaryModel,
      codingAgentModel: harness.intake.codingAgentModel,
      capabilityPolicy: harness.intake.capabilityPolicy,
    },
    agent: {
      id: agent.id,
      nodeType: "agent",
      label: agent.label,
      role: agent.role,
      model: agent.model,
      status: agent.status,
      capabilityIds: [...agent.capabilityIds],
      dependencyIds,
      specArtifactIds: [...agent.specArtifactIds],
      skillArtifactIds: [...agent.skillArtifactIds],
      scriptArtifactIds: [...agent.scriptArtifactIds],
    },
    runtimeBinding: {
      contractArtifactId: contractId,
      sourceArtifactId: ids.sourceArtifactId,
      compiledArtifactId: ids.compiledArtifactId,
      backtestArtifactId: ids.backtestArtifactId,
      contractVersion: "specx.contract.v1",
      entry: runtimeOrder === 0,
      dependencyIds: canonicalizeDependencyIds(dependencyIds, harness.id),
      requiredCapabilities: [...requiredCapabilities],
      requiredArtifacts: canonicalizeArrayByOrder(
        REQUIRED_SPECX_ARTIFACTS,
        REQUIRED_SPECX_ARTIFACTS,
      ),
      outputFields: roleOutput.requiredFields,
      runtimeOrder,
      sourceHash: "",
      backtestStatus: "pending",
    },
    outputContract: {
      artifactType: "agent.output",
      outputType: `${agent.role}.runtime-output.v1`,
      role: agent.role,
      roleResponsibilities: roleOutput.roleResponsibilities,
      requiredFields: roleOutput.requiredFields,
      contentFields: roleOutput.contentFields,
      qualityGates: roleOutput.qualityGates,
    },
    validation: {
      requiredArtifacts: canonicalizeArrayByOrder(
        REQUIRED_SPECX_ARTIFACTS,
        REQUIRED_SPECX_ARTIFACTS,
      ),
      requiredChecks: [
        "source schema validation",
        "compiled payload validation",
        "runtime binding backtest",
      ],
      runtimeGate: "runtime may execute only after backtest success and dependency completion",
      contractGate: "compiled contract must round-trip without mutation",
    },
    backtest: {
      cases: canonicalizeBacktestCases([
        { id: "contract_source_present", name: "contract source present", expected: "pass" },
        { id: "contract_compiled_roundtrip", name: "contract compiles and round-trips", expected: "pass" },
        { id: "runtime_binding_resolvable", name: "runtime binding resolves from graph", expected: "pass" },
        { id: "runtime_output_contract_valid", name: "runtime output contract valid", expected: "pass" },
      ]),
      expectedFailureModes: ["missing_dependency", "missing_capability", "contract_schema_violation"],
    },
  };

  const canonicalPayload = canonicalizeSpecxContractPayload(payload);
  const sourceHash = hashContractPayload(canonicalPayload, ["runtimeBinding", "sourceHash"]);
  const withHash = setNestedValue(canonicalPayload, ["runtimeBinding", "sourceHash"], sourceHash) as SpecxContractSourcePayload;
  const sourceText = JSON.stringify(withHash, null, 2);
  return { payload: withHash, sourceText, sourceHash };
}

export function canonicalizeSpecxContractPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as ContractRecord;
  const harness = canonicalizeObjectWithOrder(record.harness as ContractRecord | undefined, specxContractSpec.nodeFieldOrders.harness);
  const agent = canonicalizeObjectWithOrder(record.agent as ContractRecord | undefined, specxContractSpec.nodeFieldOrders.agent);
  const runtimeBinding = canonicalizeRuntimeBinding(record.runtimeBinding as ContractRecord | undefined);
  const outputContract = canonicalizeObjectWithOrder(record.outputContract as ContractRecord | undefined, specxContractSpec.nodeFieldOrders.outputContract);
  const validation = canonicalizeObjectWithOrder(record.validation as ContractRecord | undefined, specxContractSpec.nodeFieldOrders.validation);
  const backtest = canonicalizeBacktest(record.backtest as ContractRecord | undefined);

  return canonicalizeObjectWithOrder(record, specxContractSpec.rootFieldOrder, {
    contractId: record.contractId,
    specFamily: record.specFamily,
    specVersion: record.specVersion,
    scope: record.scope,
    harness,
    agent,
    runtimeBinding,
    outputContract,
    validation,
    backtest,
  });
}

export function validateSpecxContractPayload(payload: unknown): { ok: boolean; errors: string[] } {
  const canonical = canonicalizeSpecxContractPayload(payload);
  const errors: string[] = [];
  const schemaOk = validateContractSchema(canonical);
  if (!schemaOk) {
    errors.push(...formatSchemaErrors(validateContractSchema.errors));
  }
  if (canonical && typeof canonical === "object" && !Array.isArray(canonical)) {
    errors.push(...validateContractOrder(canonical as ContractRecord));
  } else {
    errors.push("/ must be an object");
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function backtestCompiledContract(
  compiledPayload: string,
  source: SpecxContractSourcePayload,
  harness: Harness,
  agent: AgentNode,
): AgentContractBacktest {
  const issues: string[] = [];
  let parsed: ContractRecord | null = null;

  try {
    parsed = JSON.parse(compiledPayload) as ContractRecord;
  } catch (error) {
    return {
      success: false,
      payload: JSON.stringify(
        {
          contractId: source.contractId,
          agentId: agent.id,
          harnessId: harness.id,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
      stdout: "",
      stderr: "compiled payload is not valid JSON",
    };
  }

  const validation = validateSpecxContractPayload(parsed);
  if (!validation.ok) {
    issues.push(...validation.errors);
  }

  if (String(parsed.contractId ?? "") !== source.contractId) {
    issues.push("compiled contractId mismatch");
  }
  if (String(parsed.specFamily ?? "") !== source.specFamily) {
    issues.push("compiled specFamily mismatch");
  }
  if (String(parsed.specVersion ?? "") !== source.specVersion) {
    issues.push("compiled specVersion mismatch");
  }
  if (String(parsed.scope ?? "") !== source.scope) {
    issues.push("compiled scope mismatch");
  }
  const parsedAgent = parsed.agent && typeof parsed.agent === "object" && !Array.isArray(parsed.agent) ? (parsed.agent as ContractRecord) : {};
  const parsedHarness = parsed.harness && typeof parsed.harness === "object" && !Array.isArray(parsed.harness) ? (parsed.harness as ContractRecord) : {};
  if (String(parsedAgent.id ?? "") !== agent.id) {
    issues.push("compiled agentId mismatch");
  }
  if (String(parsedHarness.id ?? "") !== harness.id) {
    issues.push("compiled harnessId mismatch");
  }

  const runtimeBinding = parsed.runtimeBinding as Partial<RuntimeContractBinding> | undefined;
  if (!runtimeBinding) {
    issues.push("runtimeBinding missing");
  } else {
    if (runtimeBinding.contractArtifactId !== source.runtimeBinding.contractArtifactId) {
      issues.push("runtimeBinding.contractArtifactId mismatch");
    }
    if (runtimeBinding.sourceArtifactId !== source.runtimeBinding.sourceArtifactId) {
      issues.push("runtimeBinding.sourceArtifactId mismatch");
    }
    if (runtimeBinding.compiledArtifactId !== source.runtimeBinding.compiledArtifactId) {
      issues.push("runtimeBinding.compiledArtifactId mismatch");
    }
    if (!Array.isArray(runtimeBinding.dependencyIds) || runtimeBinding.dependencyIds.length < specxContractSpec.minimums.runtimeDependenciesMinItems) {
      issues.push("runtime binding dependencyIds missing");
    }
    if (!Array.isArray(runtimeBinding.requiredCapabilities) || runtimeBinding.requiredCapabilities.length < specxContractSpec.minimums.requiredCapabilitiesMinItems) {
      issues.push("runtime binding requiredCapabilities missing");
    }
    if (!Array.isArray(runtimeBinding.requiredArtifacts) || runtimeBinding.requiredArtifacts.length < specxContractSpec.minimums.requiredArtifactsMinItems) {
      issues.push("runtime binding requiredArtifacts incomplete");
    }
    if (!Array.isArray(runtimeBinding.outputFields) || runtimeBinding.outputFields.length < specxContractSpec.minimums.outputFieldsMinItems) {
      issues.push("runtime binding outputFields incomplete");
    }
    if (runtimeBinding.backtestStatus !== "pending" && runtimeBinding.backtestStatus !== "success" && runtimeBinding.backtestStatus !== "failure") {
      issues.push("runtime binding backtestStatus invalid");
    }
  }

  const expectedCaseIds = source.backtest.cases.map((entry) => entry.id);
  const parsedBacktest = parsed.backtest && typeof parsed.backtest === "object" && !Array.isArray(parsed.backtest) ? (parsed.backtest as ContractRecord) : {};
  const actualCaseIds = Array.isArray(parsedBacktest.cases)
    ? (parsedBacktest.cases as Array<{ id?: string }>).map((entry) => String(entry?.id ?? ""))
    : [];
  for (const caseId of expectedCaseIds) {
    if (!actualCaseIds.includes(caseId)) {
      issues.push(`missing backtest case ${caseId}`);
    }
  }

  const success = issues.length === 0;
  const payload = {
    contractId: source.contractId,
    agentId: agent.id,
    harnessId: harness.id,
    success,
    issues,
    runtimeBinding: runtimeBinding
      ? {
          ...runtimeBinding,
          backtestStatus: success ? "success" : "failure",
        }
      : null,
    cases: source.backtest.cases,
  };
  return {
    success,
    payload: JSON.stringify(payload, null, 2),
    stdout: success ? `backtest:${source.contractId}:pass` : "",
    stderr: success ? "" : issues.join("; "),
  };
}

export function buildFinalizedRuntimeBinding(
  sourceBinding: RuntimeContractBinding,
  compileResult: { compiledHash: string },
  backtestArtifactId: string,
  backtestStatus: "success" | "failure",
): RuntimeContractBinding {
  return {
    ...sourceBinding,
    backtestArtifactId,
    backtestStatus,
    compiledHash: compileResult.compiledHash,
  };
}

function canonicalizeRuntimeBinding(value: ContractRecord | undefined): ContractRecord {
  const dependencyIds = Array.isArray(value?.dependencyIds) ? (value.dependencyIds as unknown[]).map((item) => String(item)) : [];
  const requiredCapabilities = Array.isArray(value?.requiredCapabilities) ? (value.requiredCapabilities as unknown[]).map((item) => String(item)) : [];
  const requiredArtifacts = Array.isArray(value?.requiredArtifacts) ? (value.requiredArtifacts as unknown[]).map((item) => String(item)) : [];
  const outputFields = Array.isArray(value?.outputFields) ? (value.outputFields as unknown[]).map((item) => String(item)) : [];
  return canonicalizeObjectWithOrder(value, specxContractSpec.nodeFieldOrders.runtimeBinding, {
    ...(value ?? {}),
    dependencyIds,
    requiredCapabilities,
    requiredArtifacts,
    outputFields,
  });
}

function buildRoleOutputContract(agent: AgentNode, harness: Harness): {
  roleResponsibilities: string[];
  requiredFields: string[];
  contentFields: string[];
  qualityGates: string[];
} {
  const roleSlug = normalizeOutputFieldPrefix(agent.role);
  const goalPhrase = harness.intake.goal.trim() || "active harness goal";
  const requiredFields = [
    `${roleSlug}Deliverable`,
    `${roleSlug}Findings`,
    `${roleSlug}Handoff`,
    `${roleSlug}Evidence`,
    `${roleSlug}Risks`,
    `${roleSlug}NextActions`,
  ];
  return {
    roleResponsibilities: [
      `Produce the ${agent.label} contribution for ${goalPhrase}.`,
      `Ground the output in the ${agent.role} role responsibilities and assigned dependencies.`,
      "Emit a task artifact that downstream agents can consume without relying on private runtime memory.",
    ],
    requiredFields,
    contentFields: requiredFields.slice(0, 4),
    qualityGates: [
      `The artifact must be specific to ${agent.role}.`,
      "The artifact must include concrete task results, not only execution metadata.",
      "The artifact must name evidence, risks, and handoff points for downstream agents.",
    ],
  };
}

function normalizeOutputFieldPrefix(role: string): string {
  const words = role
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return "agent";
  }
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");
}

function canonicalizeBacktest(value: ContractRecord | undefined): ContractRecord {
  const cases = canonicalizeBacktestCases(
    Array.isArray(value?.cases)
      ? (value.cases.filter((item): item is SpecxBacktestCase => Boolean(item) && typeof item === "object" && !Array.isArray(item)) as SpecxBacktestCase[])
      : [],
  );

  return canonicalizeObjectWithOrder(value, ["cases", "expectedFailureModes"], {
    cases,
    expectedFailureModes: Array.isArray(value?.expectedFailureModes) ? [...(value.expectedFailureModes as unknown[]).map((item) => String(item))] : [],
  });
}

function canonicalizeObjectWithOrder(value: ContractRecord | undefined, expectedOrder: string[], overrides: ContractRecord = {}): ContractRecord {
  const source = value ?? {};
  const ordered: ContractRecord = {};
  for (const key of expectedOrder) {
    if (key in overrides) {
      ordered[key] = overrides[key];
    } else if (key in source) {
      ordered[key] = source[key];
    }
  }
  for (const key of Object.keys(overrides)) {
    if (!(key in ordered)) {
      ordered[key] = overrides[key];
    }
  }
  for (const key of Object.keys(source)) {
    if (!(key in ordered)) {
      ordered[key] = source[key];
    }
  }
  return ordered;
}

function hashContractPayload(payload: unknown, omitPath: string[]): string {
  const cloned = deepClone(payload);
  if (omitPath.length > 0) {
    deleteNestedValue(cloned as ContractRecord, omitPath);
  }
  return hash16(JSON.stringify(cloned));
}

function setNestedValue(payload: unknown, path: string[], value: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || path.length === 0) {
    return payload;
  }

  const cloned = deepClone(payload) as ContractRecord;
  let cursor: ContractRecord = cloned;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as ContractRecord;
  }
  cursor[path[path.length - 1]] = value;
  return cloned;
}

function deleteNestedValue(payload: ContractRecord, path: string[]): void {
  let cursor: ContractRecord | undefined = payload;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cursor = next as ContractRecord;
  }
  delete cursor[path[path.length - 1]];
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveDependencyIds(blueprint: HarnessBlueprint, agentId: string, harnessId: string): string[] {
  const dependencyIds = new Set<string>();
  for (const edge of blueprint.edges) {
    if (edge.target !== agentId) {
      continue;
    }
    if (edge.relation !== "delegates_to" && edge.relation !== "depends_on") {
      continue;
    }
    dependencyIds.add(edge.source);
  }

  if (dependencyIds.size === 0) {
    dependencyIds.add(harnessId);
  }

  return Array.from(dependencyIds);
}

function formatSchemaErrors(errors: unknown[] | null | undefined): string[] {
  if (!errors) {
    return [];
  }

  return errors.map((error) => {
    if (!error || typeof error !== "object") {
      return "/ invalid";
    }
    const instancePath = "instancePath" in error ? String((error as { instancePath?: string }).instancePath || "/") : "/";
    const message = "message" in error ? String((error as { message?: string }).message || "invalid") : "invalid";
    return `${instancePath} ${message}`;
  });
}

function validateContractOrder(payload: ContractRecord): string[] {
  const errors: string[] = [];
  const harnessRecord = payload.harness && typeof payload.harness === "object" && !Array.isArray(payload.harness) ? (payload.harness as ContractRecord) : {};
  const harnessId = String(harnessRecord.id ?? "");
  errors.push(...validateObjectOrder("/", payload, specxContractSpec.rootFieldOrder, specxContractSpec.canonicalization.strictRootOrder));
  if (payload.harness && typeof payload.harness === "object" && !Array.isArray(payload.harness)) {
    errors.push(...validateObjectOrder("/harness", payload.harness as ContractRecord, specxContractSpec.nodeFieldOrders.harness, specxContractSpec.canonicalization.strictNodeOrder));
  }
  if (payload.agent && typeof payload.agent === "object" && !Array.isArray(payload.agent)) {
    errors.push(...validateObjectOrder("/agent", payload.agent as ContractRecord, specxContractSpec.nodeFieldOrders.agent, specxContractSpec.canonicalization.strictNodeOrder));
  }
  if (payload.runtimeBinding && typeof payload.runtimeBinding === "object" && !Array.isArray(payload.runtimeBinding)) {
    errors.push(
      ...validateObjectOrder(
        "/runtimeBinding",
        payload.runtimeBinding as ContractRecord,
        specxContractSpec.nodeFieldOrders.runtimeBinding,
        specxContractSpec.canonicalization.strictNodeOrder,
      ),
    );
    errors.push(
      ...validateCanonicalArrayOrder(
        "/runtimeBinding/dependencyIds",
        (payload.runtimeBinding as ContractRecord).dependencyIds,
        canonicalizeDependencyIds(
          Array.isArray((payload.runtimeBinding as ContractRecord).dependencyIds)
            ? ((payload.runtimeBinding as ContractRecord).dependencyIds as unknown[]).map((item) => String(item))
            : [],
          harnessId,
        ),
      ),
    );
    errors.push(
      ...validateCanonicalArrayOrder(
        "/runtimeBinding/requiredArtifacts",
        (payload.runtimeBinding as ContractRecord).requiredArtifacts,
        canonicalizeArrayByOrder(
          REQUIRED_SPECX_ARTIFACTS,
          REQUIRED_SPECX_ARTIFACTS,
        ),
      ),
    );
    errors.push(
      ...validateDynamicOutputFields(
        "/runtimeBinding/outputFields",
        (payload.runtimeBinding as ContractRecord).outputFields,
      ),
    );
  }
  if (payload.outputContract && typeof payload.outputContract === "object" && !Array.isArray(payload.outputContract)) {
    errors.push(
      ...validateObjectOrder(
        "/outputContract",
        payload.outputContract as ContractRecord,
        specxContractSpec.nodeFieldOrders.outputContract,
        specxContractSpec.canonicalization.strictNodeOrder,
      ),
    );
    errors.push(
      ...validateDynamicOutputFields(
        "/outputContract/requiredFields",
        (payload.outputContract as ContractRecord).requiredFields,
      ),
    );
    errors.push(
      ...validateDynamicOutputFields(
        "/outputContract/contentFields",
        (payload.outputContract as ContractRecord).contentFields,
      ),
    );
  }
  if (payload.validation && typeof payload.validation === "object" && !Array.isArray(payload.validation)) {
    errors.push(
      ...validateObjectOrder(
        "/validation",
        payload.validation as ContractRecord,
        specxContractSpec.nodeFieldOrders.validation,
        specxContractSpec.canonicalization.strictNodeOrder,
      ),
    );
    errors.push(
      ...validateCanonicalArrayOrder(
        "/validation/requiredArtifacts",
        (payload.validation as ContractRecord).requiredArtifacts,
        canonicalizeArrayByOrder(
          REQUIRED_SPECX_ARTIFACTS,
          REQUIRED_SPECX_ARTIFACTS,
        ),
      ),
    );
    errors.push(
      ...validateCanonicalArrayOrder(
        "/validation/requiredChecks",
        (payload.validation as ContractRecord).requiredChecks,
        [
          "source schema validation",
          "compiled payload validation",
          "runtime binding backtest",
        ],
      ),
    );
  }
  if (payload.backtest && typeof payload.backtest === "object" && !Array.isArray(payload.backtest)) {
    errors.push(...validateBacktestObject(payload.backtest as ContractRecord));
  }
  return errors;
}

function validateBacktestObject(value: ContractRecord): string[] {
  const errors: string[] = [];
  errors.push(...validateObjectOrder("/backtest", value, ["cases", "expectedFailureModes"], specxContractSpec.canonicalization.strictNodeOrder));
  const cases = Array.isArray(value.cases) ? value.cases : [];
  if (cases.length < specxContractSpec.minimums.backtestCasesMinItems) {
    errors.push("/backtest/cases must contain at least two items");
  }
  errors.push(
    ...validateCanonicalArrayOrder(
      "/backtest/cases",
      cases,
      canonicalizeBacktestCases(
        [
          { id: "contract_source_present", name: "contract source present", expected: "pass" },
          { id: "contract_compiled_roundtrip", name: "contract compiles and round-trips", expected: "pass" },
          { id: "runtime_binding_resolvable", name: "runtime binding resolves from graph", expected: "pass" },
          { id: "runtime_output_contract_valid", name: "runtime output contract valid", expected: "pass" },
        ],
      ),
    ),
  );
  return errors;
}

function validateObjectOrder(
  path: string,
  value: ContractRecord,
  expectedOrder: string[],
  strictOrder: boolean,
): string[] {
  if (!strictOrder) {
    return [];
  }

  const keys = Object.keys(value);
  const expectedPresent = expectedOrder.filter((key) => key in value);
  const matches = keys.length === expectedPresent.length && keys.every((key, index) => key === expectedPresent[index]);
  if (!matches) {
    return [`${path} key order must be ${expectedPresent.join(" -> ")}`];
  }
  return [];
}

function canonicalizeDependencyIds(values: string[], harnessIdOrSourceId: string): string[] {
  const unique = Array.from(new Set(values.map((value) => String(value)).filter(Boolean)));
  unique.sort((left, right) => {
    if (left === harnessIdOrSourceId) {
      return -1;
    }
    if (right === harnessIdOrSourceId) {
      return 1;
    }
    return left.localeCompare(right);
  });
  return unique;
}

function canonicalizeArrayByOrder(values: string[], order: string[]): string[] {
  const present = new Set(values.map((value) => String(value)));
  return order.filter((item) => present.has(item));
}

function canonicalizeBacktestCases(values: SpecxBacktestCase[]): SpecxBacktestCase[] {
  const order = specxContractSpec.arrayOrders.backtestCases.order;
  return values
    .map((item) => canonicalizeObjectWithOrder(item as ContractRecord, ["id", "name", "expected"]) as SpecxBacktestCase)
    .sort((left, right) => order.indexOf(String(left.id ?? "")) - order.indexOf(String(right.id ?? "")));
}

function validateCanonicalArrayOrder(path: string, value: unknown, expected: unknown[]): string[] {
  if (!Array.isArray(value)) {
    return [`${path} must be an array`];
  }
  const expectedSerialized = JSON.stringify(expected);
  const actualSerialized = JSON.stringify(value);
  if (expectedSerialized !== actualSerialized) {
    return [`${path} must follow the canonical order`];
  }
  return [];
}

function validateDynamicOutputFields(path: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [`${path} must be an array`];
  }
  const fields = value.map((item) => String(item));
  const errors: string[] = [];
  if (fields.length < specxContractSpec.minimums.outputFieldsMinItems) {
    errors.push(`${path} must contain at least ${specxContractSpec.minimums.outputFieldsMinItems} role-specific fields`);
  }
  const legacy = new Set(["summary", "nodeId", "status", "trace"]);
  const legacyFields = fields.filter((field) => legacy.has(field));
  if (legacyFields.length > 0) {
    errors.push(`${path} cannot use legacy generic output fields: ${legacyFields.join(", ")}`);
  }
  if (new Set(fields).size !== fields.length) {
    errors.push(`${path} cannot contain duplicate fields`);
  }
  return errors;
}
