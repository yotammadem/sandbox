---
name: typescript-backend
description: Build or extend an opinionated TypeScript HTTP backend using Fastify, Zod, explicit feature routes and application-owned infrastructure. Use for new Node HTTP APIs and changes to services adopting this profile.
---

# TypeScript backend — v0.1.0

## Decisions

Use Node.js 22+ (a supported LTS), npm, TypeScript strict mode, ESM with NodeNext module resolution, Fastify 5 and Zod 4. Use Node's test runner with compiled TypeScript; use Fastify inject for HTTP integration tests. Use native fetch for outbound HTTP. Use Fastify's built-in Pino logging. Commit the lockfile. No Express, NestJS, decorators, controller discovery, DI container, generic base service or application-specific framework package.

## Layout

    src/
      main.ts
      app.ts
      config.ts
      http/
        errors.ts
        health.routes.ts
      features/
        tasks/
          tasks.dto.ts
          create-task.route.ts
          get-task.route.ts
          create-task.ts
          get-task.ts
          tasks.repository.ts
      infrastructure/
        postgres.ts
    test/
      tasks.test.ts

Use one file per endpoint and register routes by explicit function calls in app.ts. Keep feature-specific DTOs next to the feature. Keep cross-feature HTTP machinery under http/. Add infrastructure only when needed. Use lower-case kebab-case file names, named exports and .js specifiers in TypeScript imports.

## Execution path

main.ts reads and validates environment configuration once, constructs concrete dependencies and starts the server. app.ts exports buildApp(deps) without opening a port. Route registration functions receive the Fastify instance and narrow dependencies as parameters; dependencies are ordinary objects, not service locators. Route handlers parse request body/params/query via Zod safeParse, reject invalid input as 400, obtain authenticated identity from verified request context where applicable, call a feature function and explicitly map the response DTO. Validate outbound DTOs in tests; never serialize database rows directly.

Feature functions own business decisions, authorization and transaction boundaries; they do not import Fastify, access process.env, or return HTTP codes. Repository functions own persistence and explicit row mapping. Introduce a narrow interface only where an actual boundary requires substitution. Do not create a repository if there is no persistence.

## HTTP and operational contract

- JSON endpoints under /api/v1; health endpoints outside it. POST creates with 201, GET returns 200 or 404; 204 for successful deletes without response body.
- Use stable error codes and a single error envelope: { error: { code, message }, requestId }. Unknown errors produce generic 500; log details server-side with redaction. Preserve framework-generated client error statuses. Never return stack traces or raw Zod input.
- Explicit authentication and resource/tenant authorization for non-public data; tenant identity comes from verified credentials, not a body field. Deny by default. Validate all untrusted input and set body limits. Configure CORS only for known origins when needed.
- Use AbortSignal.timeout for outbound fetch, check response.ok, validate response data. Retry only explicitly safe/idempotent operations with bounded attempts and jitter.
- Liveness is process health; readiness reflects essential dependencies with bounded checks. On SIGTERM/SIGINT stop accepting requests, drain in-flight work and close resources within the deployment grace period.
- No magic scanning, global mutable dependency registries or dynamic plugin discovery. Use direct library calls for basic operations.

## Implementation workflow

1. Read application architecture.md and inspect existing feature before editing.
2. Define DTOs and feature function; add repository operation if needed.
3. Register the route explicitly; implement authorization and error paths.
4. Test via Fastify inject: happy path, invalid request, not found/conflict, denied identity and sanitized unexpected error as applicable.
5. Run typecheck, build and tests. Review import direction: features may depend on domain contracts, not HTTP infrastructure.

Read [HTTP example](references/http-example.md) before creating a service. Copy and adapt the files, never import the skill from the application.

## Done

A reviewer can trace an endpoint from app.ts to route to feature to persistence using direct calls. The service builds and runs without this skill. Deviations are documented, and no unrelated abstraction is added.
