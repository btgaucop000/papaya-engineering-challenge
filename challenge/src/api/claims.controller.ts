import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";

import { ClaimsApiService } from "./claims-api.service.js";
import {
  AssignAssessorDto,
  CompleteAssessmentDto,
  ConfirmPaymentDto,
  EmptyDto,
  RecordAdditionalInformationDto,
  SetDocumentsDto,
  TransitionDto,
} from "./dto.js";

const claimIdPipe = new ParseUUIDPipe({ version: "4" });

@Controller()
export class ClaimsController {
  constructor(private readonly claims: ClaimsApiService) {}

  @Get("health")
  health() {
    return { status: "ok" };
  }

  @Get("demo-users")
  listDemoUsers() {
    return this.claims.listDemoUsers();
  }

  @Get("claims")
  listClaims() {
    return this.claims.listClaims();
  }

  @Get("claims/:claimId")
  getClaim(@Param("claimId", claimIdPipe) claimId: string) {
    return this.claims.getClaim(claimId);
  }

  @Get("claims/:claimId/transitions")
  previewTransitions(
    @Param("claimId", claimIdPipe) claimId: string,
    @Headers("x-demo-user-id") userId: string | undefined,
  ) {
    return this.claims.previewTransitions(claimId, userId);
  }

  @Post("claims/:claimId/transitions")
  @HttpCode(HttpStatus.OK)
  transition(
    @Param("claimId", claimIdPipe) claimId: string,
    @Headers("x-demo-user-id") userId: string | undefined,
    @Body() input: TransitionDto,
  ) {
    return this.claims.transition(claimId, userId, input);
  }

  @Get("claims/:claimId/audit")
  listAudit(@Param("claimId", claimIdPipe) claimId: string) {
    return this.claims.listAudit(claimId);
  }

  @Put("claims/:claimId/documents")
  setDocuments(
    @Param("claimId", claimIdPipe) claimId: string,
    @Headers("x-demo-user-id") userId: string | undefined,
    @Body() input: SetDocumentsDto,
  ) {
    return this.claims.setDocuments(claimId, userId, input);
  }

  @Put("claims/:claimId/assessor")
  assignAssessor(
    @Param("claimId", claimIdPipe) claimId: string,
    @Headers("x-demo-user-id") userId: string | undefined,
    @Body() input: AssignAssessorDto,
  ) {
    return this.claims.assignAssessor(claimId, userId, input.assessorId);
  }

  @Put("claims/:claimId/assessment-report")
  completeAssessment(
    @Param("claimId", claimIdPipe) claimId: string,
    @Headers("x-demo-user-id") userId: string | undefined,
    @Body() input: CompleteAssessmentDto,
  ) {
    return this.claims.completeAssessment(claimId, userId, input);
  }

  @Post("claims/:claimId/additional-information")
  recordAdditionalInformation(
    @Param("claimId", claimIdPipe) claimId: string,
    @Headers("x-demo-user-id") userId: string | undefined,
    @Body() input: RecordAdditionalInformationDto,
  ) {
    return this.claims.recordAdditionalInformation(claimId, userId, input);
  }

  @Put("claims/:claimId/payment-confirmation")
  confirmPayment(
    @Param("claimId", claimIdPipe) claimId: string,
    @Headers("x-demo-user-id") userId: string | undefined,
    @Body() input: ConfirmPaymentDto,
  ) {
    return this.claims.confirmPayment(claimId, userId, input);
  }

  @Post("claims/:claimId/member-acknowledgement")
  @HttpCode(HttpStatus.OK)
  acknowledgeRejection(
    @Param("claimId", claimIdPipe) claimId: string,
    @Body() _input: EmptyDto,
  ) {
    return this.claims.acknowledgeRejection(claimId);
  }

  @Post("claims/:claimId/system-actions/run")
  @HttpCode(HttpStatus.OK)
  runEligibleSystemAction(
    @Param("claimId", claimIdPipe) claimId: string,
    @Body() _input: EmptyDto,
  ) {
    return this.claims.runEligibleSystemAction(claimId);
  }
}
