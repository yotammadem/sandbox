# Changeflow identity and agent authorization

**Status:** partially implemented. GitHub App sign-in and first-party sessions are implemented; per-user repository connections and agent authorization remain proposed.

This document defines how a free, multi-user Changeflow service can use GitHub for user identity and repository access while allowing a user's chosen AI agent to work through a narrow, revocable grant. It complements [`SYSTEM_SPEC.md`](./SYSTEM_SPEC.md): Task documents remain portable JSON blobs in a user's private GitHub data repository, while account and authorization metadata lives in a small Cloudflare D1 database.

The current implementation covers only account identity: `GET /auth/github/start`, `GET /auth/github/callback`, `GET /api/auth/me`, and `POST /api/auth/logout`. The Worker serves the UI from the same origin. The task API still uses the single prototype bearer token and fixed deployment-wide storage repository, so the new login must not be mistaken for per-user Task authorization.

## 1. Keep the three permissions separate

These are different decisions and must never be inferred from one another:

1. **User identity:** Which GitHub account is signed in?
2. **Repository access:** Which repositories has the user authorized Changeflow to read or update?
3. **Agent delegation:** Which Changeflow operations may a particular agent perform, on which Task, and for how long?

Signing in does not authorize repository access. Connecting a repository does not authorize an agent. Installing an agent skill does not grant any access by itself.

## 2. Recommended GitHub integration

Use a **GitHub App** as the service integration. Use the GitHub App user authorization flow to sign the person in and link the GitHub subject to a Changeflow account. Ask the user to install the App only when they connect a repository.

For the initial repository-backed service, request only the permissions needed for the selected operation. The data repository needs Contents read/write. A reviewed code repository should start read-only and be optional; request only the specific read permissions needed for a future diff/PR integration. Do not request repository write access merely because an agent can update Changeflow review state.

### 2.1 Two repository connections

The account UI must show separate controls and labels for:

- **Changeflow data repository** — a private repository selected to store Task JSON. Changeflow needs Contents read/write there.
- **Project repositories** — repositories the user develops and wants to review in Changeflow. Changeflow needs read-only Git object access to retrieve pinned commit diffs. These repositories remain the source of truth for code and are never written by Changeflow in the initial product.

The roles can point at the same GitHub repository only if the user explicitly chooses that, but neither permission implies the other. The account layer stores stable GitHub repository IDs and their owning installation IDs. Task documents and Changeset code references may refer to those IDs; they never store credentials or trust a raw `owner/repo` from a request. See [`SYSTEM_SPEC.md` section 4.2.1](./SYSTEM_SPEC.md#421-data-repository-versus-project-repositories).

### 2.2 Changeset-to-repository mapping and diff retrieval

The agent associates each implementation revision with an explicit code reference: repository ID, base commit SHA, head commit SHA, and the ordered commit bundle. That mapping is part of the Changeset implementation metadata and is validated against repositories the user connected. A Changeset can have multiple code references for a multi-repo change; each is rendered as a separate diff section. The MVP requires each code reference to describe one contiguous, reviewable base-to-head range. Commit order alone does not create Changeset dependencies.

The review client requests a Changeset diff from the Changeflow Worker. The Worker checks the user's repository connection and token permissions, fetches the pinned comparison from GitHub, and returns normalized file metadata and hunks. The browser and agent never receive GitHub installation credentials. Store the computed logical patch fingerprint and bounded diff metadata for approval invalidation, but fetch actual source text on demand rather than copying patches into Task JSON. A partial/truncated upstream response must trigger deterministic tree/blob fallback or an explicit unavailable state; never represent an incomplete response as the full diff. Detailed API behavior, limits, fallback, and mobile rendering are specified in [`SYSTEM_SPEC.md` section 4.2.2](./SYSTEM_SPEC.md#422-linking-changesets-to-code-and-obtaining-a-review-diff).

The Worker holds the GitHub App private key as a secret and mints short-lived installation tokens server-side, scoped to the selected installation, repositories, and permissions. Never send the App private key, installation token, or GitHub user token to the browser or agent. A GitHub App installation token is short-lived (currently one hour) and can be restricted to selected repositories and permissions. User access tokens are a separate option when a call must act with the user's own identity; choose them deliberately rather than treating them as interchangeable.

GitHub identity is not the Changeflow agent credential. GitHub tokens must not be accepted as bearer tokens for the Changeflow API/MCP server.

## 3. Agent connection and consent

Expose Changeflow as an MCP server protected by OAuth 2.1. An agent is an OAuth client; Changeflow is the resource server. The user starts **Connect an agent** from a project or Task. The agent completes an authorization-code flow with PKCE, and the user sees a consent page naming the client, requested permissions, target project/Task/repositories, and grant duration before approving.

If an agent cannot open an interactive browser, use a short-lived device/authorization code. The human opens the consent URL on their phone, approves the exact grant, and the agent polls or exchanges the code. The code is single-use, expires quickly, and grants nothing until the human approves it.

Offer two clear grant modes:

| Mode | Scope and expiry | Use |
|---|---|---|
| **Temporary** | One Task and one review iteration; expires when that iteration is handed back or after a short maximum TTL (for example 24 hours). | Default for trying an agent or delegating a specific feedback round. |
| **Persistent** | Explicitly selected project and capabilities; no fixed end date, but access tokens remain short-lived and the grant can be revoked immediately. | User's trusted, recurring agent connection. |

Do not offer an unbounded “all my repositories” grant as the default. Persistent means the delegation record remains active; it does not mean a long-lived bearer token.

## 4. Capabilities and human authority

Scopes should name operations, not broad roles. Suggested capabilities:

| Capability | Agent may | Human remains responsible for |
|---|---|---|
| `task.read`, `review.read`, `feedback.read` | Read the explicitly granted Task and its history/feedback. | Choosing which Task to connect. |
| `discussion.write` | Add agent comments and replies to request threads. | Human-authored feedback and attribution. |
| `changeset.propose` | Add/update implementation metadata and revisions. | Accepting the implementation. |
| `knowledge.propose` | Propose assumptions/decisions or revisions with agent attribution. | Verifying/rejecting assumptions and adopting/cancelling decisions. |
| `structure.propose` | Propose dependency changes, split, merge, or reorder through typed changeset commands. | Approving the requested structural outcome. |
| `iteration.complete` | Mark preparation complete and return the Task to review. | Submitting the human feedback package. |

Agent grants must never include `changeset.approve`, human timeout/reject/request-changes decisions, `feedback.submit`, user grant management, or repository installation management. A human can ask the agent to split or merge by creating a request; the agent performs the typed structural operation under `structure.propose`, and the event log links the result to the request.

The server derives the actor from the validated OAuth principal and active grant. It ignores or rejects any client-supplied `actor: "human"` or `actor: "agent"` label. Every event records the authenticated user or agent client and grant ID.

## 5. Grant record and storage placement

Store authorization and account records in D1, not in Task JSON and not in the user's GitHub repository. They are cross-Task security metadata, and GitHub file history is not an appropriate place for revocation-sensitive credentials.

An `agent_grants` record should contain at minimum:

```json
{
  "grantId": "grant_…",
  "userId": "github-subject-id",
  "clientId": "registered-mcp-client-id",
  "clientLabel": "User-selected agent name",
  "projectId": "project_…",
  "taskIds": ["task_…"],
  "scopes": ["task.read", "feedback.read", "discussion.write", "changeset.propose"],
  "mode": "temporary",
  "iteration": 3,
  "createdAt": "…",
  "expiresAt": "…",
  "revokedAt": null,
  "lastUsedAt": "…"
}
```

Persist only identifiers and grant state in D1; store token hashes for opaque refresh/device credentials, never plaintext long-lived secrets. OAuth access tokens should be short-lived, audience-bound to Changeflow, and carry only necessary scopes. Before each mutation, validate token issuer/audience/expiry and check the active grant and target Task/project. Checking the grant record on writes means revocation takes effect immediately even before an access token expires.

The Task JSON remains the source of truth for Changesets, engineering knowledge, requests, feedback, and the append-only event history. Its event actor references the grant ID/client ID but contains no credential. The GitHub storage adapter resolves the Task's configured data repository on the server from the authenticated owner's connection metadata; clients cannot choose an arbitrary owner/repository path.

## 6. Consent, audit, and revocation

The consent screen shows the agent/client name, user, project/Task, requested capabilities, repository names and access level, grant mode, and expiry. The default selection is temporary and least-privilege. Re-consent is required to add scopes, Tasks, or repositories.

The account settings page lists active and expired grants with last-used time and a one-tap revoke action. Revocation disables the grant immediately, revokes refresh credentials, and emits an audit event. GitHub App installation removal or permission changes also invalidate associated repository connections; handle GitHub installation/revocation webhooks and surface a reconnect state.

Log grant creation, approval, scope changes, token exchange, mutation, expiry, and revocation. Avoid logging raw tokens or sensitive code contents. Rate-limit authorization attempts and protect OAuth state/PKCE/device codes against CSRF, replay, and brute force.

## 7. API transition from the prototype

The current API has one shared bearer secret and accepts `actor` in the command body. This is adequate only for the isolated prototype. Before exposing it to users or agents:

1. Add GitHub App login/callback and account/session endpoints.
2. Add MCP OAuth authorization, token, consent, and revocation endpoints (or a compatible authorization server component).
3. Add D1 account, GitHub installation/repository connection, OAuth client, and agent-grant records.
4. Replace the shared API token with validated user or agent principals. Resolve `actor` on the server.
5. Add per-command capability checks and task/project ownership checks before calling the existing domain layer.
6. Keep `TaskStore` replaceable. Its GitHub adapter receives an already-authorized repository context from the account layer; it must not decide who is allowed to access a Task.

This means the free-service shape can use D1 for small identity/grant metadata and GitHub repositories for the larger portable Task JSON documents. It does not require turning Task state into relational tables.

## 8. First deployable milestones

1. **Single-user validation:** GitHub App sign-in, connect one private data repository, and Worker-side secret handling. No public agent access yet.
2. **Safe agent pilot:** MCP OAuth with temporary one-Task grants, capability checks, audit, and immediate revoke.
3. **Usable service:** persistent project grants, multiple repository connections, grant management UI, abuse controls, and operational monitoring.

Do not publish the current shared-token prototype as a multi-user service. The authentication and grant flow must be implemented before opening agent write access to untrusted clients.
