import { type DynamicModule, Module } from "@nestjs/common";
import type { Pool } from "pg";

import {
  ClaimApplicationService,
  type ClaimApplicationServiceOptions,
} from "../persistence/index.js";
import { WorkflowEngine, type WorkflowDefinition } from "../workflow/index.js";
import { ClaimsApiService } from "./claims-api.service.js";
import { ClaimsController } from "./claims.controller.js";
import {
  CLAIM_APPLICATION_SERVICE,
  DATABASE_POOL,
  WORKFLOW_DEFINITION,
} from "./tokens.js";

export type ClaimsApiModuleOptions = {
  readonly pool: Pool;
  readonly definition: WorkflowDefinition;
  readonly applicationOptions?: ClaimApplicationServiceOptions;
};

@Module({})
export class ClaimsApiModule {
  static register(options: ClaimsApiModuleOptions): DynamicModule {
    const engine = new WorkflowEngine(options.definition);
    const application = new ClaimApplicationService(
      options.pool,
      engine,
      options.definition,
      options.applicationOptions,
    );

    return {
      module: ClaimsApiModule,
      controllers: [ClaimsController],
      providers: [
        { provide: DATABASE_POOL, useValue: options.pool },
        { provide: CLAIM_APPLICATION_SERVICE, useValue: application },
        { provide: WORKFLOW_DEFINITION, useValue: options.definition },
        ClaimsApiService,
      ],
    };
  }
}
