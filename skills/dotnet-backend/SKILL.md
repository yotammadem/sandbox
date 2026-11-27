---
name: dotnet-backend
description: Build or extend opinionated C# HTTP services using ASP.NET Core Minimal APIs, explicit route modules and application-owned feature code. Use for new .NET HTTP services and endpoints adopting this profile.
---

# .NET backend — v0.1.0

## Decisions

Use ASP.NET Core Minimal APIs on .NET 10 LTS for new services. Nullable enabled, async I/O and CancellationToken propagated to dependencies. System.Text.Json, ASP.NET Core built-in logging and health checks, xUnit and WebApplicationFactory for integration tests. Use the built-in DI container only for hosting infrastructure and explicit service registrations at the composition root; no application service locator. No MVC controllers, MediatR, AutoMapper, reflection-based endpoint discovery or generic base handlers. Persistence is deliberately outside this skill.

## Layout

    src/Api/
      Program.cs
      Http/
        ApiErrors.cs
      Features/
        Tasks/
          TaskDtos.cs
          CreateTaskEndpoint.cs
          GetTaskEndpoint.cs
          CreateTask.cs
          GetTask.cs
          ITaskReader.cs
      Infrastructure/
    tests/Api.Tests/
      TasksTests.cs

Each endpoint has a file and an explicit Map call in Program.cs (or a feature registration file explicitly called by Program.cs). DTOs are records next to their feature. Feature methods accept plain arguments and narrowly scoped dependencies, return typed results or domain errors; no HttpContext or IResult outside HTTP layer. Use explicit DTO mapping, not automatic mapping. Prefer plain methods over classes with one artificial interface; use interfaces at real replaceable I/O boundaries.

## HTTP and composition

- Routes under /api/v1. Validate untrusted input explicitly before side effects; use straightforward guards for small DTOs. Handle malformed JSON and binding failures with framework 400 behavior. Configure application-owned exception mapping and ProblemDetails for unexpected failures, without exposing stack traces. Explicitly map expected not-found, conflict and validation outcomes to HTTP status.
- Authentication and authorization are explicit policies for protected endpoints. Require verified identity and resource/tenant authorization before access. Do not use request-provided tenant IDs as identity. Set payload limits and CORS allowlists if needed.
- Program.cs validates configuration on startup, registers dependencies explicitly with appropriate lifetimes and maps endpoints. Never resolve application services dynamically from IServiceProvider inside business code.
- Use ILogger with structured fields; redact secrets. Use IHttpClientFactory for outbound clients, explicit timeouts, cancellation and status checks. Never retry unsafe requests blindly.
- Expose liveness separately from bounded readiness checks. Use host shutdown and dispose resources. Ensure hosted background work respects cancellation.

## Workflow

Read [endpoint example](references/endpoint-example.md). Implement DTO, feature function, endpoint mapping, then tests. Run dotnet build and dotnet test. Use WebApplicationFactory with a test dependency override; test actual HTTP status, validation, authorization, serialization and error behavior. Do not introduce a mediator or application-specific shared framework to remove a few direct calls.

## Done

The route-to-feature-to-I/O call chain is visible in source; API code has no generated runtime dependency on this skill; expected errors and cancellation are covered; deviations are explicit.
