# Generative frameworks

An opinionated architecture is reusable knowledge, not necessarily a reusable runtime package. These skills prescribe how an agent builds and maintains an application using ordinary, explicit, application-owned source code.

## Catalog

| Skill | Owns |
| --- | --- |
| [typescript-backend](typescript-backend/SKILL.md) | HTTP services, routing, DTOs, composition, errors |
| [react-frontend](react-frontend/SKILL.md) | Browser apps, feature layout, UI state, API calls |
| [postgres-persistence](postgres-persistence/SKILL.md) | SQL, migrations, transactions and repositories |
| [dotnet-backend](dotnet-backend/SKILL.md) | C# HTTP services, DTOs and explicit composition |

Each directory is an Agent Skill with a SKILL.md entrypoint. Copy the desired directories into the consuming project's .claude/skills/ directory (or use your agent's equivalent skill registration). Do not install this catalog as a runtime package. To use a skill directly from this repository, ask the agent to read its SKILL.md and follow its linked examples. The examples are source material, not imported libraries.

## Contract (v0.1.0)

- Select one backend skill per service. React may consume either backend. PostgreSQL can be composed with the TypeScript backend; the .NET backend does not prescribe persistence and needs its own persistence profile if SQL is required.
- On new applications, follow the selected profile; don't reopen settled decisions without a concrete requirement. On existing applications, report conflicts instead of silently migrating unrelated code.
- Record the selected skill names and Git commit in an application-owned architecture.md. Document approved deviations with reason and scope.
- Copy and adapt examples into local source; keep normal ecosystem libraries when they implement complex, well-maintained primitives. No generated code may import this catalog, and no generator or agent should be required to build, test or run the app.
- Prefer explicit calls and composition over discovery, reflection, decorators, DI containers, generic base classes and custom DSLs. Avoid needless duplication within an individual application; duplication across applications is acceptable when it keeps each application independently understandable.
- Update by inspecting the diff between skill revisions and proposing a scoped, tested source migration. Security fixes in copied code must be tracked across consumers; a skill update alone does not patch existing apps.
- Treat examples as starting points, not production guarantees. Verify dependency compatibility, run the consuming app's tests and review generated code.

## Acceptance experiment

Give two independent agents the same small CRUD requirement and the same pinned skill. Compare file layout, dependencies, boundary behavior, security checks, integration tests and review effort. Record deviations. Then change a skill convention and ask both agents to migrate their applications without introducing a runtime dependency. The goal is predictable architecture, not byte-identical source.
