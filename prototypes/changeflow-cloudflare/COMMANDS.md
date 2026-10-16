# Changeflow command reference

This page lists every domain command currently accepted by `POST /api/tasks/{taskId}/commands`. It is the implementation reference for the prototype; commands not listed here are rejected as unsupported.

## Command envelope

The JSON body has this shape:

```json
{
  "type": "comment.add",
  "actor": "human",
  "payload": { "body": "Please clarify the failure case." }
}
```

Every command request also needs these headers:

```http
Authorization: Bearer <CHANGEFLOW_API_TOKEN>
If-Match: "<current Task revision>"
Idempotency-Key: <stable ID for this command and its retries>
Content-Type: application/json
```

`If-Match` is the ETag returned by `GET /api/tasks/{taskId}`. A successful mutation advances the Task revision. Retry the exact same body with the same idempotency key. After `409 revision_conflict`, reload the Task and reconcile before sending a new command with a new key.

## Supported commands

| `type` | Intended actor | Required payload | Optional payload | Result |
|---|---|---|---|---|
| `comment.add` | Human or agent | `body` | `targets` | Adds a comment event to the global log. If targets are omitted or empty, the Task is targeted. |
| `request.create` | Human only | `requestId`, `instruction` | `category` (defaults to `general`), `targets` (defaults to Task) | Creates a general instruction/thread for the agent. |
| `request.message.add` | Human or agent | `requestId`, `body` | `status` | Appends a message to an existing request thread and optionally changes its status. |
| `feedback.submit` | Human only | `packageId` | `afterRevision` (defaults to `0`) | Snapshots the changes since the cursor, reviews and knowledge state; moves Task to `agent` and increments iteration. |
| `iteration.complete` | Agent only | — | `summary` | Moves a Task awaiting agent preparation back to `review`. |
| `knowledge.upsert` | Human or agent | `kind`, `id`, `title` | `links`, `status`, `rejectionReason` | Creates or updates a decision/assumption and records old/new links as event targets. |
| `changeset.upsert` | Intended for agent | `changeset` | — | Creates a Changeset or updates its implementation/details while retaining its review record for basis revalidation. |
| `changeset.dependencies.set` | Human or agent | `changesetId`, `dependencies` | — | Replaces the dependency list; rejects missing IDs and cycles. |
| `changeset.review` | Intended for human | `changesetId`, `status` | `feedback` (required when status is `changes`) | Records approval, requested changes, timeout rejection, or recheck state. Timeout needs no explanation. |
| `changeset.split.apply` | Agent only | `sourceId`, `changesets` (at least 2) | Each result may include its own `deps` | Archives the source, creates active results, rewrites downstream dependencies, and logs the lineage. |
| `changeset.merge.apply` | Agent only | `sourceIds` (at least 2), `result` | — | Archives sources, creates an active result, derives its dependencies, rewrites downstream references, and logs the lineage. |
| `implementation.finalize` | Agent only | `changesetId`, `commitBundle` with exactly one commit | `previousCommitCount`, `patchFingerprint` | Records a history rewrite to one commit. Approval survives if patch fingerprint and relevant basis are unchanged. |

### Payload details

#### `comment.add`

```json
{
  "body": "Please clarify why this fallback is needed.",
  "targets": [
    { "kind": "changeset", "id": "api-fallback" },
    { "kind": "assumption", "id": "legacy-client" }
  ]
}
```

`body` is 1–8,000 characters. Each target must exist and use `task`, `changeset`, `decision`, `assumption`, or `request` as its `kind`.

#### `request.create` and `request.message.add`

```json
{
  "requestId": "req-clarify-fallback",
  "category": "simplify",
  "instruction": "Keep the behavior, but split this Changeset so each path is easier to review.",
  "targets": [{ "kind": "changeset", "id": "api-fallback" }]
}
```

A request is a freeform human instruction; split and merge are not human-issued structural commands. The agent replies with `request.message.add`, which may set status to `working`, `needs-human`, `proposed`, `completed`, or `declined` (or `submitted`).

#### `feedback.submit`

```json
{ "packageId": "review-iteration-1", "afterRevision": 1 }
```

The package records event IDs whose revision is greater than `afterRevision`, active Changeset review outcomes, and current decision/assumption revisions and statuses. Earlier events are retained. `afterRevision` must be an integer between zero and the current revision.

#### `knowledge.upsert`

Create or update a decision:

```json
{
  "kind": "decision",
  "id": "reuse-db",
  "title": "Use the existing database instead of adding a cache.",
  "status": "active",
  "links": ["api-fallback", "request-store"]
}
```

Create or reject an assumption:

```json
{
  "kind": "assumption",
  "id": "legacy-client",
  "title": "The fallback is required only for legacy clients.",
  "status": "rejected",
  "rejectionReason": "The current client still calls this path.",
  "links": ["api-fallback"]
}
```

`links` is a complete replacement list of Changeset IDs. Decision statuses are `active`, `rejected`, or `cancelled`; cancellation remains in history. Assumption statuses are `unverified`, `verified`, or `rejected`; assumptions cannot be cancelled. Rejecting an assumption without a reason sets `needsInvestigation: true` for the agent.

#### `changeset.upsert`

```json
{
  "changeset": {
    "id": "request-store",
    "title": "Persist request metadata",
    "intent": "Keep request state durable across worker restarts.",
    "deps": ["task-document"],
    "implementation": {
      "revision": 2,
      "patchFingerprint": "sha256:logical-patch-fingerprint",
      "commitBundle": {
        "revisionId": "implementation-2",
        "commits": [{ "sha": "abc1234", "order": 1, "subject": "persist request metadata" }]
      }
    },
    "knowledgeLinks": {
      "decisions": ["reuse-db"],
      "assumptions": ["legacy-client"]
    }
  }
}
```

`commitBundle.commits` contains 1–20 commits during normal work. A Changeset has a stable ID. On update, the implementation revision/fingerprint is appended to its implementation history when changed; approval is then revalidated.

#### `changeset.dependencies.set`

```json
{ "changesetId": "request-store", "dependencies": ["task-document", "request-types"] }
```

The whole list is replaced. Dependencies must be active Changesets, cannot include the current Changeset, and cannot create a cycle.

#### `changeset.review`

```json
{ "changesetId": "request-store", "status": "approved" }
```

Allowed statuses: `pending`, `approved`, `changes`, `timeout`, `recheck`. For request changes, include text:

```json
{ "changesetId": "request-store", "status": "changes", "feedback": "Move the retry logic into the caller and add a concurrency test." }
```

For timeout, send only `changesetId` and `status: "timeout"`; no explanation is needed. `approved` stores a basis composed from logical patch fingerprint, recursive dependencies, and linked engineering knowledge.

#### `changeset.split.apply`

```json
{
  "sourceId": "large-refactor",
  "changesets": [
    { "id": "refactor-parser", "title": "Refactor parser", "intent": "...", "implementation": { "revision": 1, "patchFingerprint": "parser-patch", "commitBundle": { "revisionId": "r1", "commits": [{ "sha": "111", "order": 1, "subject": "refactor parser" }] } } },
    { "id": "refactor-caller", "title": "Update caller", "intent": "...", "implementation": { "revision": 1, "patchFingerprint": "caller-patch", "commitBundle": { "revisionId": "r1", "commits": [{ "sha": "222", "order": 1, "subject": "update caller" }] } } }
  ]
}
```

Each result uses the same Changeset fields as `changeset.upsert`; `deps` defaults to the source's dependencies. The source remains archived in the document and event log; results become the active nodes.

#### `changeset.merge.apply`

```json
{
  "sourceIds": ["refactor-parser", "refactor-caller"],
  "result": {
    "id": "refactor-request-path",
    "title": "Refactor request path",
    "intent": "Keep the two inseparable changes together.",
    "implementation": {
      "revision": 1,
      "patchFingerprint": "combined-patch",
      "commitBundle": { "revisionId": "r1", "commits": [{ "sha": "333", "order": 1, "subject": "refactor request path" }] }
    }
  }
}
```

The result uses the Changeset fields shown in `changeset.upsert`. Its dependencies are derived from the source nodes' dependencies. The source nodes are retained as archived lineage.

#### `implementation.finalize`

```json
{
  "changesetId": "request-store",
  "previousCommitCount": 3,
  "commitBundle": {
    "revisionId": "merge-ready-1",
    "commits": [{ "sha": "def5678", "order": 1, "subject": "persist request metadata" }]
  }
}
```

The new bundle must contain exactly one commit. `patchFingerprint` is optional; if supplied and different, the approval is invalidated. A new SHA alone does not invalidate approval.

## Actor enforcement in this prototype

Some commands enforce actor checks in code: request creation and feedback submission require `human`; iteration completion, split, merge, and implementation finalization require `agent`. Other commands accept any of the three actor labels (`human`, `agent`, `system`), even where the table says “intended for”. This is not an authorization boundary: the caller currently chooses the `actor` field and the API uses one shared bearer token. Real identity and role-based authorization must replace this before multi-user or untrusted-agent use.

## HTTP operations (not domain commands)

| Method/path | Behavior |
|---|---|
| `GET /health` | Public health check. |
| `POST /api/tasks` | Creates a Task from `{ "taskId", "title", "description?" }`; initializes revision 1 and a `task.created` event. |
| `GET /api/tasks/{taskId}` | Returns current Task and revision ETag. |
| `GET /api/tasks/{taskId}/events?afterRevision=N` | Returns events with revision greater than `N`. |
| `POST /api/tasks/{taskId}/commands` | Accepts one command using the envelope and concurrency headers above. |
