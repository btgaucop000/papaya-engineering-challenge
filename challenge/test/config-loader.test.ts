import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, test } from "node:test";

import {
  loadWorkflowDefinition,
  parseWorkflowDefinition,
  WorkflowConfigError,
} from "../src/workflow/index.js";

const configPath = resolve("challenge/config/claims-workflow.json");
const validInput = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;

const cloneConfig = (): Record<string, unknown> => structuredClone(validInput);

function expectConfigError(input: unknown, expectedPath: string, messagePart: string): void {
  assert.throws(
    () => parseWorkflowDefinition(input),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowConfigError);
      assert.equal(error.code, "INVALID_WORKFLOW_CONFIG");
      assert.equal(error.path, expectedPath);
      assert.match(error.message, new RegExp(messagePart));
      return true;
    },
  );
}

describe("workflow config loader", () => {
  test("loads the complete claims workflow from JSON", async () => {
    const definition = await loadWorkflowDefinition(configPath);

    assert.equal(definition.id, "claims-workflow");
    assert.equal(definition.states.length, 8);
    assert.equal(definition.transitions.length, 9);
    assert.equal(definition.settings.appealPeriodDays, 14);
    assert.equal(definition.cycleLimits[0]?.max, 3);
    assert.ok(Object.isFrozen(definition));
  });

  test("binds effect phases to the registry", () => {
    const config = cloneConfig();
    const transitions = config.transitions as Array<Record<string, unknown>>;
    const firstEffects = transitions[0]?.effects as Array<Record<string, unknown>>;
    delete firstEffects[0]?.phase;

    const definition = parseWorkflowDefinition(config);

    assert.equal(definition.transitions[0]?.effects[0]?.phase, "afterCommit");
  });

  test("rejects duplicate state identifiers with a precise path", () => {
    const config = cloneConfig();
    const states = config.states as Array<Record<string, unknown>>;
    states[1]!.id = states[0]!.id;

    expectConfigError(config, "$.states[1]", "duplicate identifier");
  });

  test("rejects an unknown transition state", () => {
    const config = cloneConfig();
    const transitions = config.transitions as Array<Record<string, unknown>>;
    transitions[0]!.to = "NOT_A_STATE";

    expectConfigError(config, "$.transitions[0].to", "unknown state");
  });

  test("rejects an unknown role", () => {
    const config = cloneConfig();
    const roles = config.roles as string[];
    roles[0] = "superuser";

    expectConfigError(config, "$.roles[0]", "unknown role");
  });

  test("rejects an unknown fact", () => {
    const config = cloneConfig();
    const transitions = config.transitions as Array<Record<string, unknown>>;
    const condition = transitions[0]!.precondition as Record<string, unknown>;
    condition.fact = "documents.unregistered";

    expectConfigError(config, "$.transitions[0].precondition.fact", "unknown fact");
  });

  test("rejects an unknown operator", () => {
    const config = cloneConfig();
    const transitions = config.transitions as Array<Record<string, unknown>>;
    const condition = transitions[0]!.precondition as Record<string, unknown>;
    condition.operator = "approximately";

    expectConfigError(config, "$.transitions[0].precondition.operator", "unknown operator");
  });

  test("rejects an unknown effect type", () => {
    const config = cloneConfig();
    const transitions = config.transitions as Array<Record<string, unknown>>;
    const effects = transitions[0]!.effects as Array<Record<string, unknown>>;
    effects[0]!.type = "send_real_email";

    expectConfigError(config, "$.transitions[0].effects[0].type", "unknown effect type");
  });

  test("rejects an effect phase that conflicts with its registry phase", () => {
    const config = cloneConfig();
    const transitions = config.transitions as Array<Record<string, unknown>>;
    const effects = transitions[0]!.effects as Array<Record<string, unknown>>;
    effects[0]!.phase = "transactional";

    expectConfigError(config, "$.transitions[0].effects[0].phase", "registered as");
  });

  test("rejects a non-positive cycle limit", () => {
    const config = cloneConfig();
    const limits = config.cycleLimits as Array<Record<string, unknown>>;
    limits[0]!.max = 0;

    expectConfigError(config, "$.cycleLimits[0].max", "positive integer");
  });

  test("rejects a cycle limit referencing an unknown transition", () => {
    const config = cloneConfig();
    const limits = config.cycleLimits as Array<Record<string, unknown>>;
    limits[0]!.transitionId = "missing_transition";

    expectConfigError(config, "$.cycleLimits[0].transitionId", "unknown transition");
  });
});
