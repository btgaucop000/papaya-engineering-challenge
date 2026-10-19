import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";

import {
  AssignedAssessorMismatchError,
  ClaimNotFoundError,
  InvalidPrerequisiteStateError,
  PaymentRequestNotReadyError,
} from "../persistence/index.js";
import {
  CycleLimitExceededError,
  InvalidTransitionError,
  PreconditionsFailedError,
  UnauthorizedRoleError,
} from "../workflow/index.js";
import {
  DemoIdentityError,
  OperationForbiddenError,
} from "./demo-identities.js";

type ErrorMapping = {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
};

type HttpResponse = {
  status(code: number): HttpResponse;
  json(body: unknown): void;
};

function mapKnownError(error: unknown): ErrorMapping | null {
  if (error instanceof DemoIdentityError) {
    return {
      statusCode: HttpStatus.UNAUTHORIZED,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof UnauthorizedRoleError) {
    return {
      statusCode: HttpStatus.FORBIDDEN,
      code: error.code,
      message: error.message,
      details: {
        transitionId: error.transitionId,
        actualRole: error.actualRole,
        requiredRoles: error.requiredRoles,
      },
    };
  }
  if (error instanceof OperationForbiddenError) {
    return {
      statusCode: HttpStatus.FORBIDDEN,
      code: error.code,
      message: error.message,
      details: {
        operation: error.operation,
        actualRole: error.actualRole,
        requiredRoles: error.requiredRoles,
      },
    };
  }
  if (error instanceof AssignedAssessorMismatchError) {
    return {
      statusCode: HttpStatus.FORBIDDEN,
      code: error.code,
      message: error.message,
      details: {
        assignedAssessorId: error.assignedAssessorId,
        actualAssessorId: error.actualAssessorId,
      },
    };
  }
  if (error instanceof ClaimNotFoundError) {
    return {
      statusCode: HttpStatus.NOT_FOUND,
      code: error.code,
      message: error.message,
      details: { claimId: error.claimId },
    };
  }
  if (error instanceof InvalidTransitionError) {
    return {
      statusCode: HttpStatus.CONFLICT,
      code: error.code,
      message: error.message,
      details: {
        currentState: error.currentState,
        transitionId: error.transitionId,
        allowedTransitionIds: error.allowedTransitionIds,
      },
    };
  }
  if (error instanceof InvalidPrerequisiteStateError) {
    return {
      statusCode: HttpStatus.CONFLICT,
      code: error.code,
      message: error.message,
      details: {
        operation: error.operation,
        currentState: error.currentState,
        allowedStates: error.allowedStates,
      },
    };
  }
  if (error instanceof PreconditionsFailedError) {
    return {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: error.code,
      message: error.message,
      details: { transitionId: error.transitionId, failures: error.failures },
    };
  }
  if (error instanceof CycleLimitExceededError) {
    return {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: error.code,
      message: error.message,
      details: {
        transitionId: error.transitionId,
        currentCount: error.currentCount,
        maximum: error.maximum,
      },
    };
  }
  if (error instanceof PaymentRequestNotReadyError) {
    return {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: error.code,
      message: error.message,
      details: { claimId: error.claimId },
    };
  }
  return null;
}

function mapHttpException(error: HttpException): ErrorMapping {
  const response = error.getResponse();
  const responseObject =
    typeof response === "object" && response !== null
      ? (response as Record<string, unknown>)
      : undefined;
  const messages = responseObject?.message;
  const message = Array.isArray(messages)
    ? "Request validation failed"
    : typeof messages === "string"
      ? messages
      : error.message;
  return {
    statusCode: error.getStatus(),
    code: error.getStatus() === HttpStatus.BAD_REQUEST ? "VALIDATION_ERROR" : "HTTP_ERROR",
    message,
    ...(Array.isArray(messages) ? { details: { violations: messages } } : {}),
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const mapping =
      mapKnownError(error) ??
      (error instanceof HttpException
        ? mapHttpException(error)
        : {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: "INTERNAL_ERROR",
            message: "An unexpected server error occurred",
          });

    if (mapping.statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
      console.error(error);
    }
    response.status(mapping.statusCode).json(mapping);
  }
}
