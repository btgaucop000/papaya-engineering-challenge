process.env.DATABASE_RUNTIME_URL ??=
  "postgresql://claims_runtime:claims_runtime@localhost:54329/claims_workflow_test";
process.env.API_PORT ??= "3100";
process.env.WORKFLOW_CONFIG_PATH ??=
  "challenge/config/claims-workflow.manual-review.json";

await import("../../dist/challenge/src/api/main.js");
