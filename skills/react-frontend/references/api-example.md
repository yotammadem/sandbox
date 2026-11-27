# API and query example

Read-only example. Put this code inside the application; no shared skill package is needed.

## src/api/request.ts

```ts
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public readonly status: number) {
    super('Request failed (' + status + ')');
  }
}

export async function getJson<S extends z.ZodType>(
  path: string, schema: S, signal?: AbortSignal,
): Promise<z.output<S>> {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('Expected API path');
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(path, {
    credentials: 'same-origin',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new HttpError(response.status);
  return schema.parse(await response.json());
}
```

## src/features/tasks/tasks.dto.ts

```ts
import { z } from 'zod';
export const tasksDto = z.array(z.object({ id: z.string(), title: z.string() }));
```

## src/features/tasks/tasks.api.ts

```ts
import { getJson } from '../../api/request';
import { tasksDto } from './tasks.dto';
export const listTasks = (signal?: AbortSignal) => getJson('/api/v1/tasks', tasksDto, signal);
```

## src/features/tasks/tasks.queries.ts

```ts
import { queryOptions } from '@tanstack/react-query';
import { HttpError } from '../../api/request';
import { listTasks } from './tasks.api';

export const tasksQuery = (scope: string) => queryOptions({
  queryKey: ['tasks', scope, 'list'],
  queryFn: ({ signal }) => listTasks(signal),
  retry: (count, error) => count < 2 && error instanceof HttpError && error.status >= 500,
});
```

## src/features/tasks/TasksPage.tsx

```tsx
import { useQuery } from '@tanstack/react-query';
import { tasksQuery } from './tasks.queries';

export function TasksPage({ scope }: { scope: string }) {
  const query = useQuery(tasksQuery(scope));
  if (query.isPending) return <p role="status">Loading tasks…</p>;
  if (query.isError && !query.data) return <p role="alert">Could not load tasks.</p>;
  return <main>
    <h1>Tasks</h1>
    {query.isError && <p role="status">Could not refresh tasks.</p>}
    {query.data?.length ? <ul>{query.data.map(task =>
      <li key={task.id}>{task.title}</li>)}</ul> : <p>No tasks yet.</p>}
  </main>;
}
```

Mount a QueryClientProvider and BrowserRouter once in app/providers.tsx. The scope is a cache partition, not an authorization credential; the API enforces authorization independently. For mutations add explicit feature-owned functions with validated response schemas and the application's CSRF mechanism.
