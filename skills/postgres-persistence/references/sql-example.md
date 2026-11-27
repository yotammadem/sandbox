# Explicit SQL example

## migrations/<timestamp>_create-tasks.cjs

```js
exports.up = pgm => {
  pgm.sql(`CREATE TABLE tasks (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
  )`);
};
exports.down = pgm => {
  // Destructive: only use for an empty disposable DB or approved rollback.
  pgm.sql('DROP TABLE tasks');
};
```

## src/infrastructure/postgres.ts

```ts
import type { Pool, PoolClient } from 'pg';

export async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}
```

An uncertain COMMIT outcome must not be blindly retried. Use application-level idempotency where clients need safe retries.

## src/features/tasks/tasks.repository.ts

```ts
import type { Pool, PoolClient } from 'pg';

type TaskRow = { id: string; title: string; created_at: Date };

export async function findTask(db: Pool | PoolClient, tenantId: string, id: string) {
  const result = await db.query<TaskRow>(
    'SELECT id, title, created_at FROM tasks WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  );
  const row = result.rows[0];
  return row ? { id: row.id, title: row.title, createdAt: row.created_at } : null;
}

export async function insertTask(db: Pool | PoolClient, tenantId: string, id: string, title: string) {
  const result = await db.query<TaskRow>(
    'INSERT INTO tasks (tenant_id, id, title) VALUES ($1, $2, $3) RETURNING id, title, created_at',
    [tenantId, id, title],
  );
  const row = result.rows[0];
  return { id: row.id, title: row.title, createdAt: row.created_at };
}
```

For a single INSERT, PostgreSQL already guarantees statement atomicity; do not add an explicit transaction unnecessarily. For multi-step operations use inTransaction and pass the same client to all queries. Keep the helper in the app itself.
