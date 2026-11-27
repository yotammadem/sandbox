---
name: postgres-persistence
description: Add PostgreSQL persistence to a TypeScript Node backend using pg, explicit SQL, versioned migrations and application-owned transaction boundaries. Use for database schema, repository or transaction work in this profile.
---

# PostgreSQL persistence — v0.1.0

## Decisions

PostgreSQL (supported major version), node-postgres (pg), node-pg-migrate for versioned migrations, parameterized SQL, explicit row mapping. No ORM, query-builder DSL, Active Record, generic CRUD repository, runtime schema synchronization, or per-request connection pool. Integration tests run against a real disposable PostgreSQL database.

## Layout

    migrations/
      <timestamp>_create-tasks.cjs
    src/
      infrastructure/
        postgres.ts
      features/
        tasks/
          tasks.repository.ts
          create-task.ts
    test/
      tasks.repository.test.ts

One pool per process, configured centrally with bounded size and connection timeout; budget pool size across replicas. Use a least-privilege application role and a separate migration role. Supply TLS settings for the deployment; verify certificates in production. Close the pool on shutdown. Do not put database credentials in code or logs.

## Schema and queries

Use UUID primary keys unless an existing schema requires otherwise, timestamptz for instants, explicit NOT NULL, foreign keys, unique constraints and check constraints. Store money as integer minor units or exact numeric with explicit mapping; never silently coerce 64-bit integers or decimals to unsafe JS numbers. Index for actual query access patterns and verify with EXPLAIN. Use parameterized SQL ($1, $2), never interpolate values; allowlist identifiers if dynamic ordering is necessary.

Use explicit column lists, stable ordering with a unique tie-breaker and keyset pagination for large lists. Repository functions accept Pool or PoolClient (or a narrow query contract). Feature functions own multi-operation transactions; pass the transaction client through each repository call. Never start a transaction on a pool and issue subsequent queries on a different connection.

For tenant-owned records use tenant_id NOT NULL and include it in every lookup and mutation. Scope unique constraints and foreign keys to tenant where appropriate. Derive tenant from authenticated context. Add cross-tenant negative tests. Consider database row-level security as a separately designed defense-in-depth mechanism, not a replacement for authorization.

## Migrations and concurrency

Migrations are immutable after deployment; add a new migration for each change. Run migrations as a dedicated deployment step, not at startup of every replica. Use expand/backfill/contract for incompatible changes and mixed application versions. Bound locks and backfill batches; large concurrent index builds need a non-transactional migration as appropriate. Plan rollback or forward repair and backups for destructive changes.

Use database constraints and atomic updates for invariants rather than check-then-write. Select isolation and locking explicitly for operations that need them. Retry complete transactions only for recognized transient conflicts (e.g. 40001/40P01), with bounded jitter and no irreversible side effects inside the retried callback. Use an outbox if a committed DB write must trigger reliable asynchronous publication.

## Workflow

Read [transaction and repository example](references/sql-example.md). Add migration, explicit repository SQL, feature transaction boundary and integration tests. Test migration from empty database, constraint behavior, tenant isolation, rollback and concurrent writers where applicable. Do not hide SQL behind general-purpose framework abstractions.

## Done

SQL and transaction ownership are visible in application source. Migrations and tests run without this skill. No SQL strings contain untrusted interpolated input, and all tenant-owned access is scoped.
