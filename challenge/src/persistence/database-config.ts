export const defaultDatabaseUrls = {
  owner: "postgresql://claims_owner:claims_owner@localhost:54329/claims_workflow",
  runtime: "postgresql://claims_runtime:claims_runtime@localhost:54329/claims_workflow",
  admin: "postgresql://claims_owner:claims_owner@localhost:54329/postgres",
  testOwner: "postgresql://claims_owner:claims_owner@localhost:54329/claims_workflow_test",
  testRuntime: "postgresql://claims_runtime:claims_runtime@localhost:54329/claims_workflow_test",
} as const;

export function ownerDatabaseUrl(testDatabase = false): string {
  return testDatabase
    ? (process.env.TEST_DATABASE_OWNER_URL ?? defaultDatabaseUrls.testOwner)
    : (process.env.DATABASE_OWNER_URL ?? defaultDatabaseUrls.owner);
}

export function runtimeDatabaseUrl(testDatabase = false): string {
  return testDatabase
    ? (process.env.TEST_DATABASE_RUNTIME_URL ?? defaultDatabaseUrls.testRuntime)
    : (process.env.DATABASE_RUNTIME_URL ?? defaultDatabaseUrls.runtime);
}
