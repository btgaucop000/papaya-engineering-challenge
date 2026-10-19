import type { Actor } from "../workflow/index.js";

export const demoUsers = Object.freeze([
  { id: "demo-document-clerk", displayName: "Dana Document Clerk", role: "document_clerk" },
  { id: "demo-team-lead", displayName: "Taylor Team Lead", role: "team_lead" },
  { id: "demo-assessor", displayName: "Alex Assessor", role: "assessor" },
  { id: "demo-finance", displayName: "Frankie Finance", role: "finance" },
] as const);

export class DemoIdentityError extends Error {
  readonly code = "UNKNOWN_DEMO_USER";

  constructor(readonly userId: string | undefined) {
    super(
      userId === undefined
        ? "The x-demo-user-id header is required"
        : `Unknown demo user: ${userId}`,
    );
    this.name = "DemoIdentityError";
  }
}

export class OperationForbiddenError extends Error {
  readonly code = "OPERATION_FORBIDDEN";

  constructor(
    readonly operation: string,
    readonly actualRole: string,
    readonly requiredRoles: readonly string[],
  ) {
    super(
      `Role "${actualRole}" cannot perform operation "${operation}". Required roles: ${requiredRoles.join(", ")}`,
    );
    this.name = "OperationForbiddenError";
  }
}

export function resolveDemoActor(userId: string | undefined): Actor {
  const user = demoUsers.find((candidate) => candidate.id === userId);
  if (user === undefined) {
    throw new DemoIdentityError(userId);
  }
  return { userId: user.id, role: user.role };
}

export function requireDemoRole(
  userId: string | undefined,
  operation: string,
  requiredRoles: readonly string[],
): Actor {
  const actor = resolveDemoActor(userId);
  if (!requiredRoles.includes(actor.role)) {
    throw new OperationForbiddenError(operation, actor.role, requiredRoles);
  }
  return actor;
}

export const demoSystemActor: Actor = Object.freeze({
  userId: "demo-system",
  role: "system",
});
