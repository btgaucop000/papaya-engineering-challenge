import { readFile } from "node:fs/promises";

import { WorkflowConfigError } from "./errors.js";
import { defaultRegistries } from "./registries.js";
import type {
  Condition,
  CycleLimit,
  EffectDescriptor,
  LeafCondition,
  WorkflowDefinition,
  WorkflowRegistries,
  WorkflowState,
  WorkflowTransition,
} from "./types.js";

type JsonObject = Record<string, unknown>;

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function fail(path: string, message: string): never {
  throw new WorkflowConfigError(path, message);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as JsonObject;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function positiveIntegerAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(path, "must be a positive integer");
  }
  return value;
}

function unique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      fail(`${path}[${index}]`, `duplicate identifier "${value}"`);
    }
    seen.add(value);
  }
}

function parseCondition(
  input: unknown,
  path: string,
  registries: WorkflowRegistries,
): Condition {
  const object = objectAt(input, path);
  const expressionKeys = ["all", "any", "not", "fact"].filter((key) => hasOwn(object, key));
  if (expressionKeys.length !== 1) {
    fail(path, "must contain exactly one of all, any, not, or fact");
  }

  if (hasOwn(object, "all") || hasOwn(object, "any")) {
    const key = hasOwn(object, "all") ? "all" : "any";
    const children = arrayAt(object[key], `${path}.${key}`);
    if (children.length === 0) {
      fail(`${path}.${key}`, "must contain at least one condition");
    }
    const parsed = children.map((child, index) =>
      parseCondition(child, `${path}.${key}[${index}]`, registries),
    );
    return key === "all" ? { all: parsed } : { any: parsed };
  }

  if (hasOwn(object, "not")) {
    return { not: parseCondition(object.not, `${path}.not`, registries) };
  }

  const fact = stringAt(object.fact, `${path}.fact`);
  if (!registries.facts.has(fact)) {
    fail(`${path}.fact`, `unknown fact "${fact}"`);
  }

  const operatorName = stringAt(object.operator, `${path}.operator`);
  const operator = registries.operators[operatorName];
  if (operator === undefined) {
    fail(`${path}.operator`, `unknown operator "${operatorName}"`);
  }

  const description = stringAt(object.description, `${path}.description`);
  const leaf: LeafCondition = { fact, operator: operatorName, description };

  if (operator.operand === "none") {
    if (hasOwn(object, "value") || hasOwn(object, "valueFromFact")) {
      fail(path, `operator "${operatorName}" does not accept an operand`);
    }
    return leaf;
  }

  if (operator.operand === "literal") {
    if (!hasOwn(object, "value") || hasOwn(object, "valueFromFact")) {
      fail(path, `operator "${operatorName}" requires value and does not accept valueFromFact`);
    }
    return { ...leaf, value: object.value };
  }

  if (hasOwn(object, "value")) {
    fail(path, `operator "${operatorName}" accepts valueFromFact, not value`);
  }
  const valueFromFact = stringAt(object.valueFromFact, `${path}.valueFromFact`);
  if (!registries.facts.has(valueFromFact)) {
    fail(`${path}.valueFromFact`, `unknown fact "${valueFromFact}"`);
  }
  return { ...leaf, valueFromFact };
}

function parseEffect(
  input: unknown,
  path: string,
  registries: WorkflowRegistries,
): EffectDescriptor {
  const object = objectAt(input, path);
  const type = stringAt(object.type, `${path}.type`);
  const registeredPhase = registries.effects[type];
  if (registeredPhase === undefined) {
    fail(`${path}.type`, `unknown effect type "${type}"`);
  }

  if (hasOwn(object, "phase")) {
    const configuredPhase = stringAt(object.phase, `${path}.phase`);
    if (configuredPhase !== registeredPhase) {
      fail(
        `${path}.phase`,
        `effect "${type}" is registered as "${registeredPhase}", not "${configuredPhase}"`,
      );
    }
  }

  const args = hasOwn(object, "args") ? objectAt(object.args, `${path}.args`) : {};
  return { type, phase: registeredPhase, args };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function parseWorkflowDefinition(
  input: unknown,
  registries: WorkflowRegistries = defaultRegistries,
): WorkflowDefinition {
  const root = objectAt(input, "$");
  const id = stringAt(root.id, "$.id");
  const version = positiveIntegerAt(root.version, "$.version");

  const settingsInput = objectAt(root.settings, "$.settings");
  const appealPeriodDays = positiveIntegerAt(
    settingsInput.appealPeriodDays,
    "$.settings.appealPeriodDays",
  );

  const roles = arrayAt(root.roles, "$.roles").map((role, index) =>
    stringAt(role, `$.roles[${index}]`),
  );
  if (roles.length === 0) {
    fail("$.roles", "must contain at least one role");
  }
  unique(roles, "$.roles");
  roles.forEach((role, index) => {
    if (!registries.roles.has(role)) {
      fail(`$.roles[${index}]`, `unknown role "${role}"`);
    }
  });

  const stateInputs = arrayAt(root.states, "$.states");
  if (stateInputs.length === 0) {
    fail("$.states", "must contain at least one state");
  }
  const states: WorkflowState[] = stateInputs.map((stateInput, index) => {
    const state = objectAt(stateInput, `$.states[${index}]`);
    return {
      id: stringAt(state.id, `$.states[${index}].id`),
      label: stringAt(state.label, `$.states[${index}].label`),
    };
  });
  unique(
    states.map((state) => state.id),
    "$.states",
  );
  const stateIds = new Set(states.map((state) => state.id));

  const transitionInputs = arrayAt(root.transitions, "$.transitions");
  if (transitionInputs.length === 0) {
    fail("$.transitions", "must contain at least one transition");
  }
  const transitions: WorkflowTransition[] = transitionInputs.map((transitionInput, index) => {
    const path = `$.transitions[${index}]`;
    const transition = objectAt(transitionInput, path);
    const transitionId = stringAt(transition.id, `${path}.id`);
    const from = stringAt(transition.from, `${path}.from`);
    const to = stringAt(transition.to, `${path}.to`);
    if (!stateIds.has(from)) {
      fail(`${path}.from`, `unknown state "${from}"`);
    }
    if (!stateIds.has(to)) {
      fail(`${path}.to`, `unknown state "${to}"`);
    }

    const transitionRoles = arrayAt(transition.roles, `${path}.roles`).map((role, roleIndex) =>
      stringAt(role, `${path}.roles[${roleIndex}]`),
    );
    if (transitionRoles.length === 0) {
      fail(`${path}.roles`, "must contain at least one role");
    }
    unique(transitionRoles, `${path}.roles`);
    transitionRoles.forEach((role, roleIndex) => {
      if (!registries.roles.has(role) || !roles.includes(role)) {
        fail(`${path}.roles[${roleIndex}]`, `unknown role "${role}"`);
      }
    });

    const effects = arrayAt(transition.effects, `${path}.effects`).map((effect, effectIndex) =>
      parseEffect(effect, `${path}.effects[${effectIndex}]`, registries),
    );

    return {
      id: transitionId,
      from,
      to,
      roles: transitionRoles,
      precondition: parseCondition(transition.precondition, `${path}.precondition`, registries),
      effects,
    };
  });
  unique(
    transitions.map((transition) => transition.id),
    "$.transitions",
  );
  const transitionIds = new Set(transitions.map((transition) => transition.id));

  const cycleLimits: CycleLimit[] = arrayAt(root.cycleLimits, "$.cycleLimits").map(
    (cycleInput, index) => {
      const path = `$.cycleLimits[${index}]`;
      const cycle = objectAt(cycleInput, path);
      const transitionId = stringAt(cycle.transitionId, `${path}.transitionId`);
      if (!transitionIds.has(transitionId)) {
        fail(`${path}.transitionId`, `unknown transition "${transitionId}"`);
      }
      const counterFact = stringAt(cycle.counterFact, `${path}.counterFact`);
      if (!registries.facts.has(counterFact)) {
        fail(`${path}.counterFact`, `unknown fact "${counterFact}"`);
      }
      return {
        transitionId,
        counterFact,
        max: positiveIntegerAt(cycle.max, `${path}.max`),
        errorMessage: stringAt(cycle.errorMessage, `${path}.errorMessage`),
      };
    },
  );
  unique(
    cycleLimits.map((cycle) => cycle.transitionId),
    "$.cycleLimits",
  );

  return deepFreeze({
    id,
    version,
    settings: { appealPeriodDays },
    roles,
    states,
    transitions,
    cycleLimits,
  });
}

export async function loadWorkflowDefinition(
  filePath: string,
  registries: WorkflowRegistries = defaultRegistries,
): Promise<WorkflowDefinition> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowConfigError("$", `cannot read workflow file: ${message}`);
  }

  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowConfigError("$", `invalid JSON: ${message}`);
  }

  return parseWorkflowDefinition(input, registries);
}
