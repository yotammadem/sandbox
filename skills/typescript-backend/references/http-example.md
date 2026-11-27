# HTTP example

A minimal public, read-only endpoint example; add real authentication before exposing private data. Use npm install fastify@5 zod@4 and npm install -D typescript @types/node. Set package.json type to module; tsconfig uses module and moduleResolution NodeNext, target ES2022, strict, rootDir ".", outDir "dist". Scripts: build = tsc; test = npm run build && node --test dist/test/tasks.test.js.

## src/http/errors.ts

```ts
import type { FastifyInstance } from 'fastify';

export class NotFound extends Error {}

export function registerErrors(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof NotFound ? 404 :
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode : 500;
    if (status === 500) request.log.error({ err: error }, 'request failed');
    const code = status === 404 ? 'NOT_FOUND' :
      status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';
    return reply.code(status).send({
      error: { code, message: status === 500 ? 'Unexpected error' :
        status === 404 ? 'Resource not found' : 'Request rejected' },
      requestId: request.id,
    });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: 'NOT_FOUND', message: 'Resource not found' }, requestId: request.id,
  }));
}
```

## src/features/tasks/tasks.dto.ts

```ts
import { z } from 'zod';
export const taskParams = z.object({ id: z.string().uuid() });
export const taskResponse = z.object({ id: z.string().uuid(), title: z.string() });
export type TaskResponse = z.infer<typeof taskResponse>;
```

## src/features/tasks/get-task.ts

```ts
export type TaskReader = (id: string) => Promise<{ id: string; title: string } | null>;
export async function getTask(id: string, readTask: TaskReader) {
  return readTask(id);
}
```

## src/features/tasks/get-task.route.ts

```ts
import type { FastifyInstance } from 'fastify';
import { taskParams, type TaskResponse } from './tasks.dto.js';
import { getTask, type TaskReader } from './get-task.js';
import { NotFound } from '../../http/errors.js';

export function registerGetTask(app: FastifyInstance, readTask: TaskReader) {
  app.get('/api/v1/tasks/:id', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({
      error: { code: 'INVALID_REQUEST', message: 'Invalid task id' }, requestId: request.id,
    });
    const task = await getTask(params.data.id, readTask);
    if (!task) throw new NotFound();
    const dto: TaskResponse = { id: task.id, title: task.title };
    return dto;
  });
}
```

## src/app.ts

```ts
import Fastify from 'fastify';
import { registerErrors } from './http/errors.js';
import { registerGetTask } from './features/tasks/get-task.route.js';
import type { TaskReader } from './features/tasks/get-task.js';

export function buildApp(deps: { readTask: TaskReader }) {
  const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 1024 * 1024 });
  registerErrors(app);
  app.get('/health/live', async () => ({ status: 'ok' }));
  registerGetTask(app, deps.readTask);
  return app;
}
```

## test/tasks.test.ts

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { taskResponse } from '../src/features/tasks/tasks.dto.js';

test('GET task validates input and maps response', async t => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const app = buildApp({ readTask: async key =>
    key === id ? { id, title: 'Example', internalSecret: 'not exposed' } : null });
  t.after(() => app.close());
  const ok = await app.inject({ method: 'GET', url: '/api/v1/tasks/' + id });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(taskResponse.parse(ok.json()), { id, title: 'Example' });
  assert.deepEqual(ok.json(), { id, title: 'Example' });
  const bad = await app.inject('/api/v1/tasks/bad');
  assert.equal(bad.statusCode, 400);
  const missing = await app.inject('/api/v1/tasks/123e4567-e89b-42d3-a456-426614174001');
  assert.equal(missing.statusCode, 404);
});
```

For a production executable, add main.ts with concrete dependency construction, validated PORT/HOST, readiness and bounded shutdown. This reference deliberately uses a test double instead of inventing persistence.
