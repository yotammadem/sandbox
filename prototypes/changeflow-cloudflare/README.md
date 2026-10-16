# Changeflow Cloudflare prototype

This is an isolated Cloudflare Worker application prototype for Changeflow. The Worker serves the mobile-first review client and API from one origin. Choose either D1/SQLite or a dedicated GitHub data repository for Task persistence; both store one JSON document per Task, and the domain model has no provider dependency. The GitHub storage mode uses D1 only for short-lived OAuth state and hashed user sessions.

Read [`SYSTEM_SPEC.md`](./SYSTEM_SPEC.md) for the system contract, document model, concurrency protocol, migration path to Azure Blob Storage, and deployment notes.
See [`COMMANDS.md`](./COMMANDS.md) for the exact supported command names, required payloads, actor behavior, and copyable request examples.
See [`SYSTEM_SPEC.md`](./SYSTEM_SPEC.md#optional-github-repository-storage) for the GitHub-versus-D1 tradeoffs and the simple `TaskStore` port.
See [`AUTH_AND_AGENT_ACCESS.md`](./AUTH_AND_AGENT_ACCESS.md) for the proposed GitHub App sign-in, repository authorization, MCP OAuth, and temporary/persistent agent-grant model.

## Current scope

- Authenticated API for creating and reading Tasks, reading the event log, and applying commands.
- D1 storage adapter with atomic revision compare-and-swap.
- Optional GitHub Contents adapter storing `tasks/<taskId>.json` and using the file blob SHA for compare-and-swap.
- In-memory adapter for deterministic domain/API tests.
- Stable Changeset IDs, explicit DAG dependencies, patch fingerprints, commit bundles, split/merge lineage, and one-commit finalization.
- Persistent assumptions, decisions, review states, comments, agent requests/conversation, and consolidated feedback packages.
- Approval retention across unrelated edits and invalidation when relevant implementation, dependencies, or knowledge changes.
- GitHub Actions workflow for tests, remote D1 migrations, and Worker deployment after this folder is moved into its own repository.

The browser client is served by the same Worker origin, so GitHub sign-in uses an HttpOnly first-party session cookie. GitHub identity is implemented, but project repository connections, user-owned Task routing, and agent grants are not. The current task API still uses one shared prototype bearer token and one deployment-wide data repository; do not expose task APIs as a multi-user service until ownership checks and per-user repository routing are implemented.

## Run locally

Requirements: Node.js 22+ and npm 10+.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set CHANGEFLOW_API_TOKEN to a random value of at least 24 characters.
npm run db:migrate:local
npm run dev
```

Run checks with:

```sh
npm test
```

Wrangler uses a local D1 database for local development. These commands do not modify your Cloudflare database. The D1 mode uses this database for both Task JSON and auth metadata.

### Try the GitHub repository storage adapter

This mode writes real commits to a dedicated repository, so use a private test repository that already has its configured branch (for example `main`). Create a fine-grained GitHub token with Contents read/write permission for that repository, set it as `GITHUB_TOKEN` in `.dev.vars`, and update `GITHUB_OWNER`/`GITHUB_REPO` in `wrangler.github.jsonc`. Then run `npm run dev:github`.

Task documents are stored as one file at `tasks/<taskId>.json`; a D1 database stores only GitHub sign-in state and sessions. Create a local auth database using `npm run db:migrate:auth:local`. The adapter rejects stale same-Task writes rather than overwriting them. Each successful update creates a Git commit. GitHub recommends serializing mutative Contents API requests; for parallel writes across many Tasks, use D1 or Azure Blob instead. If a provider write conflict occurs, the API returns `503`; retry the exact command with the same idempotency key.

Verify the Worker can reach the configured private repo and branch before creating Tasks:

```sh
curl -i http://localhost:8787/api/storage/status \
  -H "Authorization: Bearer $CHANGEFLOW_API_TOKEN"
```

The response reports only the selected repository ID/name and branch; it never returns the GitHub token. This first connection is deployment-wide: all prototype Tasks use the one configured data repository. Per-user repository selection comes after GitHub user authentication and is not implemented yet.

### Sign in with GitHub

Create a **GitHub App** (not an OAuth App) and enable user authorization. Register the exact callback `http://localhost:8787/auth/github/callback` for local testing. Set the three `GITHUB_APP_*` values in `.dev.vars`, then visit `http://localhost:8787/auth/github/start`. The browser returns to the Worker and receives an HttpOnly session cookie. The app header displays the signed-in GitHub login. The user access token from GitHub is used only to fetch the identity and is discarded; Changeflow stores a hash of its own short-lived session token.

The same flow uses HTTPS and a `__Host-` Secure cookie when deployed. The Worker serves the app's static assets from the same origin, avoiding cross-site cookie restrictions on iPhone Safari. Apply the D1 migrations before starting the Worker; the GitHub storage deployment uses D1 for auth metadata while Task blobs remain in the configured GitHub data repo.

## Try the API

Set a shell variable for the local token you put in `.dev.vars`, then create a Task:

```sh
curl -i http://localhost:8787/api/tasks \
  -H "Authorization: Bearer $CHANGEFLOW_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"backend-refactor-1","title":"Refactor request handling"}'
```

Read the Task and use its returned ETag as the next write's `If-Match` value:

```sh
curl -i http://localhost:8787/api/tasks/backend-refactor-1 \
  -H "Authorization: Bearer $CHANGEFLOW_API_TOKEN"

curl -i http://localhost:8787/api/tasks/backend-refactor-1/commands \
  -X POST \
  -H "Authorization: Bearer $CHANGEFLOW_API_TOKEN" \
  -H 'If-Match: "1"' \
  -H 'Idempotency-Key: request-create-0001' \
  -H 'Content-Type: application/json' \
  -d '{"type":"request.create","actor":"human","payload":{"requestId":"req-1","category":"simplify","instruction":"Keep the existing fallback and explain the boundary."}}'
```

Each mutation advances the Task revision. On `409 revision_conflict`, read the latest Task and reconcile before retrying. Retries of the same command must reuse the same idempotency key and exact request body.

## Move to a separate repo and deploy

The Worker serves the client from `../../apps/changeflow` in this monorepo. If moving the Worker to a separate repository, copy the app's deployable static files into an asset directory and update the Wrangler `assets.directory` first.

1. Create the D1 database used by the chosen config and update its ID in the corresponding Wrangler file. In GitHub storage mode, run `npm run db:create:auth`; D1 then holds OAuth/session metadata only.
2. Set Cloudflare deployment secrets, `GITHUB_TOKEN`, and `GITHUB_APP_CLIENT_SECRET`; set `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CALLBACK_URL` as Worker vars or secrets.
3. Set the GitHub App callback URL to the deployed Worker origin plus `/auth/github/callback`.
4. Apply `npm run db:migrate:auth:remote` for GitHub storage, or `npm run db:migrate:remote` for D1 Task storage, then deploy the matching Wrangler configuration. The workflow in this nested prototype directory is inert until a deploy workflow is installed at the repository root.

The D1 migration must run against an existing D1 database. Worker deployment is not attempted until test and migration steps pass. You can also use `npm run db:migrate:remote` and `npm run deploy` manually.

## Main files

- `SYSTEM_SPEC.md` — detailed system specification.
- `AUTH_AND_AGENT_ACCESS.md` — production identity, repository permission, MCP consent, and agent grant design.
- `COMMANDS.md` — command catalog and payload reference.
- `src/domain.js` — JSON document shape and domain commands.
- `src/store.js` — D1 and in-memory storage adapters.
- `src/github-store.js` — optional GitHub Contents storage adapter.
- `src/index.js` — Worker HTTP API.
- `migrations/0001_create_task_blobs.sql` — one-row-per-Task D1 schema.
- `test/` — domain and HTTP protocol tests.
- `.github/workflows/deploy.yml` — deployment workflow for the standalone repository.
- `wrangler.github.jsonc` — GitHub storage configuration without a D1 binding.
