import assert from "node:assert/strict";
import { resolve } from "node:path";

import { loadWorkflowDefinition } from "../workflow/index.js";

const basePath = resolve("challenge/config/claims-workflow.json");
const extensionPath = resolve("challenge/config/claims-workflow.manual-review.json");
const base = await loadWorkflowDefinition(basePath);
const extension = await loadWorkflowDefinition(extensionPath);

const addedStates = extension.states.filter(
  (state) => !base.states.some((candidate) => candidate.id === state.id),
);
const addedTransitions = extension.transitions.filter(
  (transition) => !base.transitions.some((candidate) => candidate.id === transition.id),
);

assert.deepEqual(addedStates, [{ id: "MANUAL_REVIEW", label: "Manual Review" }]);
assert.deepEqual(
  addedTransitions.map((transition) => transition.id),
  ["send_to_manual_review", "return_to_assessment"],
);
assert.ok(addedTransitions.every((transition) => transition.roles.includes("team_lead")));
assert.ok(
  addedTransitions.every(
    (transition) =>
      "fact" in transition.precondition &&
      transition.precondition.fact === "assessment.reportComplete" &&
      transition.precondition.operator === "eq",
  ),
);
assert.deepEqual(
  addedTransitions.flatMap((transition) => transition.effects.map((effect) => effect.type)),
  ["notify_member", "notify_assessor_team"],
);

console.log(
  JSON.stringify(
    {
      verification: "EXT-01 config validation and delta",
      status: "PASS",
      baseConfig: "challenge/config/claims-workflow.json",
      extensionConfig: "challenge/config/claims-workflow.manual-review.json",
      baseStateCount: base.states.length,
      extensionStateCount: extension.states.length,
      baseTransitionCount: base.transitions.length,
      extensionTransitionCount: extension.transitions.length,
      addedStates,
      addedTransitions,
      reusedCapabilities: {
        role: "team_lead",
        fact: "assessment.reportComplete",
        operator: "eq",
        effectHandlers: ["notify_member", "notify_assessor_team"],
      },
    },
    null,
    2,
  ),
);
