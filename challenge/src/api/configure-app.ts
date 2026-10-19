import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";

import { ApiExceptionFilter } from "./api-exception.filter.js";

export function configureClaimsApi(app: INestApplication): void {
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}
