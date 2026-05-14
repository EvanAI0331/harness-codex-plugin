import Ajv from "ajv/dist/2020";
import { findAgencyAgentByRole } from "@/lib/agency-agents/catalog";
import plannerSpec from "shared/specs/planner/blueprint.spec.json";
import schema from "shared/schemas/harness-blueprint.schema.json";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema as object);

type BlueprintRecord = Record<string, unknown>;

const plannerBlueprintSpec = plannerSpec as {
  rootFieldOrder: string[];
  nodeFieldOrders: Record<string, string[]>;
  canonicalization: {
    strictRootOrder: boolean;
    strictNodeOrder: boolean;
    strictArrayOrder: boolean;
    rejectEmptyCollections: boolean;
    rejectUnknownFields: boolean;
  };
  arrayOrders: {
    agents: { sortKey: string; order: string[] };
    specs: { sortKey: string; mirrorArray: string; description: string };
    capabilities: { sortKey: string; order: string[]; tieBreakers: string[] };
    edges: {
      sortKey: string;
      segments: Array<{
        name: string;
        description: string;
        classes: Array<{
          name: string;
          relations: string[];
          tieBreakers: string[];
          description: string;
        }>;
      }>;
      description: string;
    };
  };
  minimums: {
    summaryMinLength: number;
    agentsMinItems: number;
    agentsMaxItems?: number;
    specsMinItems: number;
    specsMaxItems?: number;
    capabilitiesMinItems: number;
    edgesMinItems: number;
  };
};

type EdgeOrderRule = {
  segmentName: string;
  className: string;
  relation: string;
  tieBreakers: string[];
  segmentIndex: number;
  classIndex: number;
  relationIndex: number;
};

export function canonicalizeBlueprintPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const blueprint = payload as BlueprintRecord;
  const agents = canonicalizeAgents(Array.isArray(blueprint.agents) ? blueprint.agents : []);
  const agentIndexById = new Map<string, number>(agents.map((agent, index) => [String(agent.id ?? ""), index] as const));
  const specs = canonicalizeSpecs(Array.isArray(blueprint.specs) ? blueprint.specs : [], agentIndexById);
  const capabilities = canonicalizeCapabilities(Array.isArray(blueprint.capabilities) ? blueprint.capabilities : []);
  const edges = canonicalizeEdges(Array.isArray(blueprint.edges) ? blueprint.edges : [], String((blueprint.harness as BlueprintRecord | undefined)?.id ?? ""), agentIndexById);

  return canonicalizeObjectWithOrder(blueprint, plannerBlueprintSpec.rootFieldOrder, {
    summary: blueprint.summary,
    harness: canonicalizeHarnessNode(blueprint.harness),
    agents,
    specs,
    capabilities,
    edges,
  });
}

export function validateBlueprintPayload(payload: unknown): { ok: boolean; errors: string[] } {
  const canonical = canonicalizeBlueprintPayload(payload);
  const errors: string[] = [];
  const ok = validate(canonical);
  if (!ok) {
    errors.push(...formatSchemaErrors(validate.errors));
  }

  if (canonical && typeof canonical === "object" && !Array.isArray(canonical)) {
    errors.push(...validateBlueprintOrder(canonical as BlueprintRecord));
  } else {
    errors.push("/ must be an object");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function canonicalizeAgents(input: unknown[]): BlueprintRecord[] {
  return input
    .filter((value): value is BlueprintRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .map((value) =>
      canonicalizeObjectWithOrder(value, plannerBlueprintSpec.nodeFieldOrders.agent, {
        ...value,
      }),
    )
    .sort((left, right) => compareByRankThenTieBreakers(left, right, [
      (record) => Number(record.executionOrder ?? Number.MAX_SAFE_INTEGER),
      (record) => String(record.role ?? ""),
      (record) => String(record.id ?? ""),
    ]));
}

function canonicalizeSpecs(input: unknown[], agentIndexById: Map<string, number>): BlueprintRecord[] {
  return input
    .filter((value): value is BlueprintRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .map((value) =>
      canonicalizeObjectWithOrder(value, plannerBlueprintSpec.nodeFieldOrders.spec, {
        ...value,
      }),
    )
    .sort((left, right) => compareByRankThenTieBreakers(left, right, [
      (record) => {
        const agentId = String(record.agentId ?? "");
        return agentIndexById.has(agentId) ? agentIndexById.get(agentId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      },
      (record) => String(record.agentId ?? ""),
      (record) => String(record.id ?? ""),
    ]));
}

function canonicalizeCapabilities(input: unknown[]): BlueprintRecord[] {
  const order = new Map(plannerBlueprintSpec.arrayOrders.capabilities.order.map((value, index) => [value, index] as const));
  return input
    .filter((value): value is BlueprintRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .map((value) =>
      canonicalizeObjectWithOrder(value, plannerBlueprintSpec.nodeFieldOrders.capability, {
        ...value,
      }),
    )
    .sort((left, right) => compareByRankThenTieBreakers(left, right, [
      (record) => resolveRank(String(record.source ?? ""), order),
      (record) => String(record.capabilityType ?? ""),
      (record) => String(record.registryKey ?? ""),
      (record) => String(record.id ?? ""),
    ]));
}

function canonicalizeEdges(input: unknown[], harnessId: string, agentIndexById: Map<string, number>): BlueprintRecord[] {
  const ruleByRelation = new Map(getEdgeOrderRules().map((rule) => [rule.relation, rule] as const));
  return input
    .filter((value): value is BlueprintRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .map((value) => canonicalizeEdgeDirection(value, harnessId, agentIndexById))
    .map((value) => canonicalizeObjectWithOrder(value, plannerBlueprintSpec.nodeFieldOrders.edge, { ...value }))
    .sort((left, right) => compareEdgeRecords(left, right, ruleByRelation));
}

function canonicalizeEdgeDirection(value: BlueprintRecord, harnessId: string, agentIndexById: Map<string, number>): BlueprintRecord {
  const relation = String(value.relation ?? "");
  const source = String(value.source ?? "");
  const target = String(value.target ?? "");

  if (relation === "contains" || relation === "delegates_to") {
    if (target === harnessId && source !== harnessId) {
      return { ...value, source: target, target: source };
    }
    return value;
  }

  if (relation === "defines") {
    const sourceIsAgent = agentIndexById.has(source);
    const targetIsAgent = agentIndexById.has(target);
    if (!sourceIsAgent && targetIsAgent) {
      return { ...value, source: target, target: source };
    }
    return value;
  }

  if (relation === "feeds" || relation === "depends_on") {
    const sourceIndex = agentIndexById.has(source) ? agentIndexById.get(source) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const targetIndex = agentIndexById.has(target) ? agentIndexById.get(target) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    if (sourceIndex > targetIndex) {
      return { ...value, source: target, target: source };
    }
    return value;
  }

  if (relation === "requires" || relation === "missing") {
    if (source === harnessId && target !== harnessId) {
      return { ...value, source: target, target: source };
    }
    return value;
  }

  return value;
}

function canonicalizeHarnessNode(value: unknown): BlueprintRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return canonicalizeObjectWithOrder(value as BlueprintRecord, plannerBlueprintSpec.nodeFieldOrders.harness, {
    ...(value as BlueprintRecord),
  });
}

function canonicalizeObjectWithOrder(
  value: BlueprintRecord,
  expectedOrder: string[],
  base: BlueprintRecord,
): BlueprintRecord {
  const ordered: BlueprintRecord = {};
  for (const key of expectedOrder) {
    if (key in base) {
      ordered[key] = base[key];
    }
  }
  for (const key of Object.keys(base)) {
    if (!(key in ordered)) {
      ordered[key] = base[key];
    }
  }
  return ordered;
}

function compareByRankThenTieBreakers(
  left: BlueprintRecord,
  right: BlueprintRecord,
  selectors: Array<(record: BlueprintRecord) => number | string>,
): number {
  for (const selector of selectors) {
    const leftValue = selector(left);
    const rightValue = selector(right);
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }
  return 0;
}

function resolveRank(value: string, order: Map<string, number>): number {
  return order.has(value) ? order.get(value) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
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

function validateBlueprintOrder(payload: BlueprintRecord): string[] {
  const errors: string[] = [];
  errors.push(...validateObjectOrder("/", payload, plannerBlueprintSpec.rootFieldOrder, plannerBlueprintSpec.canonicalization.strictRootOrder));

  const harness = payload.harness;
  if (harness && typeof harness === "object" && !Array.isArray(harness)) {
    errors.push(
      ...validateObjectOrder(
        "/harness",
        harness as BlueprintRecord,
        plannerBlueprintSpec.nodeFieldOrders.harness,
        plannerBlueprintSpec.canonicalization.strictNodeOrder,
      ),
    );
  }

  const agents = Array.isArray(payload.agents) ? payload.agents : [];
  errors.push(...validateAgentArray("/agents", agents, plannerBlueprintSpec.nodeFieldOrders.agent));
  errors.push(...validateSpecsMirrorAgents(payload, agents));
  errors.push(
    ...validateSortedNodeArray(
      "/capabilities",
      Array.isArray(payload.capabilities) ? payload.capabilities : [],
      plannerBlueprintSpec.nodeFieldOrders.capability,
      [
        (record) => resolveRank(String(record.source ?? ""), new Map(plannerBlueprintSpec.arrayOrders.capabilities.order.map((value, index) => [value, index] as const))),
        (record) => String(record.capabilityType ?? ""),
        (record) => String(record.registryKey ?? ""),
        (record) => String(record.id ?? ""),
      ],
      "source",
      plannerBlueprintSpec.arrayOrders.capabilities.order,
    ),
  );
  errors.push(
    ...validateSegmentedEdges(
      "/edges",
      Array.isArray(payload.edges) ? payload.edges : [],
      plannerBlueprintSpec.nodeFieldOrders.edge,
      getEdgeOrderRules(),
    ),
  );

  const minimums = plannerBlueprintSpec.minimums;
  if (typeof payload.summary !== "string" || payload.summary.trim().length < minimums.summaryMinLength) {
    errors.push("/summary must be a non-empty string");
  }
  if (!Array.isArray(payload.agents) || payload.agents.length < minimums.agentsMinItems) {
    errors.push(`/agents must contain at least ${minimums.agentsMinItems} items`);
  }
  if (!Array.isArray(payload.specs) || payload.specs.length < minimums.specsMinItems) {
    errors.push(`/specs must contain at least ${minimums.specsMinItems} items`);
  }
  if (!Array.isArray(payload.capabilities) || payload.capabilities.length < minimums.capabilitiesMinItems) {
    errors.push("/capabilities must contain at least one item");
  }
  if (!Array.isArray(payload.edges) || payload.edges.length < minimums.edgesMinItems) {
    errors.push("/edges must contain at least one item");
  }

  return errors;
}

function validateAgentArray(path: string, array: unknown[], expectedFieldOrder: string[]): string[] {
  const errors: string[] = [];
  if (array.length < plannerBlueprintSpec.minimums.agentsMinItems) {
    errors.push(`${path} must contain at least ${plannerBlueprintSpec.minimums.agentsMinItems} items`);
  }

  const executionOrders: number[] = [];
  const roles = new Set<string>();

  array.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path}/${index} must be an object`);
      return;
    }

    const record = item as BlueprintRecord;
    errors.push(...validateObjectOrder(`${path}/${index}`, record, expectedFieldOrder, plannerBlueprintSpec.canonicalization.strictNodeOrder));

    const role = String(record.role ?? "");
    const agentKind = String(record.agentKind ?? "");
    const executionOrder = record.executionOrder;
    const catalogGroup = String(record.catalogGroup ?? "");
    const catalog = findAgencyAgentByRole(role);

    if (!catalog) {
      errors.push(`${path}/${index}.role must exist in the agency-agents catalog`);
    } else if (catalog.group !== catalogGroup) {
      errors.push(`${path}/${index}.catalogGroup must match the catalog entry for ${role}`);
    }

    if (agentKind !== "dispatcher" && agentKind !== "expert" && agentKind !== "coding") {
      errors.push(`${path}/${index}.agentKind must be dispatcher, expert, or coding`);
    }

    if (typeof executionOrder !== "number" || !Number.isInteger(executionOrder) || executionOrder < 0) {
      errors.push(`${path}/${index}.executionOrder must be a non-negative integer`);
    } else {
      executionOrders.push(executionOrder);
    }

    if (roles.has(role)) {
      errors.push(`${path}/${index}.role must be unique`);
    }
    roles.add(role);
  });

  if (array.length > 0) {
    const sorted = [...array]
      .filter((item): item is BlueprintRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .sort((left, right) => Number(left.executionOrder ?? Number.MAX_SAFE_INTEGER) - Number(right.executionOrder ?? Number.MAX_SAFE_INTEGER));

    if (sorted.length > 0) {
      const dispatcherRecord = sorted[0] as BlueprintRecord;
      const dispatcherCatalog = findAgencyAgentByRole(String(dispatcherRecord.role ?? ""));
      if (String(dispatcherRecord.agentKind ?? "") !== "dispatcher") {
        errors.push(`${path}/0.agentKind must be dispatcher`);
      }
      if (!dispatcherCatalog?.dispatcher) {
        errors.push(`${path}/0.role must resolve to the dispatcher entry in the agency-agents catalog`);
      }
      for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index] as BlueprintRecord;
        const currentCatalog = findAgencyAgentByRole(String(current.role ?? ""));
        if (String(current.agentKind ?? "") !== "expert" && String(current.agentKind ?? "") !== "coding") {
          errors.push(`${path}/${index}.agentKind must be expert or coding`);
        }
        if (currentCatalog?.dispatcher) {
          errors.push(`${path}/${index}.role cannot reuse the dispatcher catalog entry`);
        }
      }
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = Number(sorted[index - 1].executionOrder ?? Number.MIN_SAFE_INTEGER);
        const current = Number(sorted[index].executionOrder ?? Number.MAX_SAFE_INTEGER);
        if (current <= previous) {
          errors.push(`${path} executionOrder values must be strictly increasing`);
          break;
        }
      }
    }
  }

  return errors;
}

function validateSpecsMirrorAgents(payload: BlueprintRecord, agents: unknown[]): string[] {
  const errors: string[] = [];
  const specs = Array.isArray(payload.specs) ? payload.specs : [];
  if (specs.length !== agents.length) {
    errors.push("/specs must mirror /agents one-to-one");
    return errors;
  }

  specs.forEach((spec, index) => {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      errors.push(`/specs/${index} must be an object`);
      return;
    }
    const specRecord = spec as BlueprintRecord;
    const agent = agents[index];
    if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
      errors.push(`/agents/${index} must be an object`);
      return;
    }
    const agentRecord = agent as BlueprintRecord;
    if (String(specRecord.agentId ?? "") !== String(agentRecord.id ?? "")) {
      errors.push(`/specs/${index}.agentId must match /agents/${index}.id`);
    }
  });

  return errors;
}

function validateSortedNodeArray(
  path: string,
  array: unknown[],
  expectedFieldOrder: string[],
  selectors: Array<(record: BlueprintRecord) => number | string>,
  sortKey: string,
  allowedOrder: string[],
): string[] {
  const errors: string[] = [];
  const expectedRank = new Map(allowedOrder.map((value, index) => [value, index] as const));

  array.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path}/${index} must be an object`);
      return;
    }

    const record = item as BlueprintRecord;
    errors.push(...validateObjectOrder(`${path}/${index}`, record, expectedFieldOrder, plannerBlueprintSpec.canonicalization.strictNodeOrder));

    const value = String(record[sortKey] ?? "");
    if (!expectedRank.has(value)) {
      errors.push(`${path}/${index}.${sortKey} must be one of ${allowedOrder.join(", ")}`);
    }
  });

  if (array.length > 1) {
    for (let index = 1; index < array.length; index += 1) {
      const left = array[index - 1];
      const right = array[index];
      if (!left || typeof left !== "object" || Array.isArray(left) || !right || typeof right !== "object" || Array.isArray(right)) {
        continue;
      }
      const leftRecord = left as BlueprintRecord;
      const rightRecord = right as BlueprintRecord;
      const comparison = compareByRankThenTieBreakers(leftRecord, rightRecord, selectors);
      if (comparison > 0) {
        errors.push(`${path} must be ordered by ${sortKey} using ${allowedOrder.join(" -> ")}`);
        break;
      }
    }
  }

  return errors;
}

function validateSegmentedEdges(
  path: string,
  array: unknown[],
  expectedFieldOrder: string[],
  rules: EdgeOrderRule[],
): string[] {
  const errors: string[] = [];
  const ruleByRelation = new Map(rules.map((rule) => [rule.relation, rule] as const));
  const relationOrder = rules.map((rule) => rule.relation);

  array.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path}/${index} must be an object`);
      return;
    }

    const record = item as BlueprintRecord;
    errors.push(...validateObjectOrder(`${path}/${index}`, record, expectedFieldOrder, plannerBlueprintSpec.canonicalization.strictNodeOrder));

    const relation = String(record.relation ?? "");
    if (!ruleByRelation.has(relation)) {
      errors.push(`${path}/${index}.relation must be one of ${relationOrder.join(", ")}`);
    }
  });

  if (array.length > 1) {
    let lastRank = -1;
    for (let index = 0; index < array.length; index += 1) {
      const item = array[index];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const record = item as BlueprintRecord;
      const relation = String(record.relation ?? "");
      const rule = ruleByRelation.get(relation);
      const rank = rule ? edgeRuleRank(rule) : Number.MAX_SAFE_INTEGER;
      if (rank < lastRank) {
        errors.push(`${path} must be ordered by structure -> dependency -> resolution using ${relationOrder.join(" -> ")}`);
        break;
      }
      lastRank = rank;
    }

    for (let index = 1; index < array.length; index += 1) {
      const left = array[index - 1];
      const right = array[index];
      if (!left || typeof left !== "object" || Array.isArray(left) || !right || typeof right !== "object" || Array.isArray(right)) {
        continue;
      }
      const leftRecord = left as BlueprintRecord;
      const rightRecord = right as BlueprintRecord;
      const comparison = compareEdgeRecords(leftRecord, rightRecord, ruleByRelation);
      if (comparison > 0) {
        errors.push(`${path} must be ordered by structure -> dependency -> resolution using ${relationOrder.join(" -> ")}`);
        break;
      }
    }
  }

  return errors;
}

function getEdgeOrderRules(): EdgeOrderRule[] {
  const rules: EdgeOrderRule[] = [];
  plannerBlueprintSpec.arrayOrders.edges.segments.forEach((segment, segmentIndex) => {
    segment.classes.forEach((edgeClass, classIndex) => {
      edgeClass.relations.forEach((relation, relationIndex) => {
        rules.push({
          segmentName: segment.name,
          className: edgeClass.name,
          relation,
          tieBreakers: edgeClass.tieBreakers,
          segmentIndex,
          classIndex,
          relationIndex,
        });
      });
    });
  });
  return rules;
}

function edgeRuleRank(rule: EdgeOrderRule): number {
  return rule.segmentIndex * 100 + rule.classIndex * 10 + rule.relationIndex;
}

function compareEdgeRecords(
  left: BlueprintRecord,
  right: BlueprintRecord,
  ruleByRelation: Map<string, EdgeOrderRule>,
): number {
  const leftRule = ruleByRelation.get(String(left.relation ?? ""));
  const rightRule = ruleByRelation.get(String(right.relation ?? ""));

  if (!leftRule || !rightRule) {
    return compareByRankThenTieBreakers(left, right, [
      (record) => String(record.relation ?? ""),
      (record) => String(record.source ?? ""),
      (record) => String(record.target ?? ""),
      (record) => String(record.id ?? ""),
    ]);
  }

  const rankDelta = edgeRuleRank(leftRule) - edgeRuleRank(rightRule);
  if (rankDelta !== 0) {
    return rankDelta;
  }

  return compareByTieBreakers(left, right, leftRule.tieBreakers);
}

function compareByTieBreakers(
  left: BlueprintRecord,
  right: BlueprintRecord,
  tieBreakers: string[],
): number {
  for (const key of tieBreakers) {
    const leftValue = String(left[key] ?? "");
    const rightValue = String(right[key] ?? "");
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }
  return 0;
}

function validateObjectOrder(
  path: string,
  value: BlueprintRecord,
  expectedOrder: string[],
  strictOrder: boolean,
): string[] {
  if (!strictOrder) {
    return [];
  }

  const keys = Object.keys(value);
  const expectedPresent = expectedOrder.filter((key) => key in value);
  const keysMatch = keys.length === expectedPresent.length && keys.every((key, index) => key === expectedPresent[index]);
  if (!keysMatch) {
    return [`${path} key order must be ${expectedPresent.join(" -> ")}`];
  }
  return [];
}
