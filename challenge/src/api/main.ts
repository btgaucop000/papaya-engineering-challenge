import "reflect-metadata";

import { resolve } from "node:path";

import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";

import { runtimeDatabaseUrl } from "../persistence/index.js";
import { loadWorkflowDefinition } from "../workflow/index.js";
import { ClaimsApiModule } from "./claims-api.module.js";
import { configureClaimsApi } from "./configure-app.js";

const definition = await loadWorkflowDefinition(
  resolve("challenge/config/claims-workflow.json"),
);
const pool = new Pool({ connectionString: runtimeDatabaseUrl(), max: 10 });
await pool.query("SELECT 1");

const app = await NestFactory.create(
  ClaimsApiModule.register({ pool, definition }),
);
configureClaimsApi(app);
app.enableShutdownHooks();

const configuredPort = Number(process.env.API_PORT ?? "3000");
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error(`API_PORT must be an integer from 1 to 65535, received: ${process.env.API_PORT}`);
}

await app.listen(configuredPort);
console.log(`Claims API listening at http://localhost:${configuredPort}/api`);
