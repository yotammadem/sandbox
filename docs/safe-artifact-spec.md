# SafeArtifact Specification

Status: Draft v0.1  
Audience: implementers of producers, validators, registries, and viewers

## 1. Purpose

SafeArtifact is a portable JSON format for rendering useful, structured UI from untrusted artifact data without allowing the artifact to execute code.

The format separates three concerns:

1. **Artifact data** — the actual content, represented as JSON.
2. **Artifact Type Definition** — a versioned JSON Schema describing valid content.
3. **View Definition** — an optional declarative description of how valid content is presented using a fixed set of trusted UI primitives.

A conforming viewer treats every artifact, schema, and View Definition as untrusted input.

## 2. Design principles

### 2.1 No artifact-supplied executable code

An artifact MUST NOT contain JavaScript, WebAssembly, executable HTML, event handlers, template code, or another general-purpose expression language.

A View Definition MAY select data using JSON Pointer. It MUST NOT evaluate expressions, interpolate source code, invoke functions, make network requests, or mutate artifact data.

The viewer itself may contain trusted application code. That code is part of the viewer implementation, not part of the artifact.

### 2.2 Types are defined by schemas

Every artifact references an immutable, versioned Artifact Type Definition. Its `contentSchema` uses the supported SafeArtifact profile of JSON Schema Draft 2020-12.

Validation is performed before rendering. Invalid artifacts fail closed.

### 2.3 Presentation is declarative

The term **View Definition** replaces “presentation layout.” It describes hierarchy, grouping, and bindings between JSON values and trusted components. It cannot define new components or behavior.

An Artifact Type Definition MAY provide a default View Definition. An individual artifact MAY provide its own View Definition when the type permits it. Both are subject to identical validation and visibility rules.

### 2.4 No hidden text

Every string value under `content` MUST be visibly rendered.

Text is not considered visible when it is available only through:

- collapsed or expandable content;
- a tooltip, hover state, focus state, or context menu;
- accessibility-only or screen-reader-only markup;
- transparent or near-transparent colors;
- foreground and background colors without sufficient contrast;
- zero-sized, clipped, covered, or off-screen elements;
- CSS-generated content, attributes, metadata, or the DOM without visible pixels;
- truncation without the complete value also being visibly rendered;
- a chart, image, icon, QR code, or other non-text encoding.

Scrolling is allowed. Text below the fold is still visible if normal scrolling reaches it without an additional reveal action.

A viewer MUST run the coverage check described in section 8. If a custom view omits text, the viewer MUST reject that view and render the canonical fallback instead.

This rule deliberately favors inspectability over aesthetics.

## 3. Threat model

SafeArtifact assumes that an attacker may control:

- every value in the artifact;
- an inline View Definition;
- an Artifact Type Definition submitted to a registry;
- URLs and labels;
- nesting, sizes, Unicode, and malformed data.

The format is designed to prevent:

- code execution and script injection;
- hidden instructions or prompt-injection text in the JSON;
- UI redressing through arbitrary styling or positioning;
- unexpected network access or data exfiltration;
- denial of service through excessive input size or structure;
- ambiguity caused by a schema or type version changing after publication.

SafeArtifact does not claim to prevent:

- deception expressed in clearly visible content;
- a user voluntarily following a malicious external link;
- disclosure after a recipient legitimately decrypts or exports an artifact;
- malicious text embedded inside image pixels. Images are therefore outside v0.1.

## 4. Artifact document

A v0.1 artifact has this shape:

```json
{
  "specVersion": "0.1",
  "id": "01K4SAFEARTIFACTEXAMPLE",
  "type": {
    "name": "example.status-report",
    "version": "1.0.0",
    "digest": "sha256-BASE64URL_DIGEST"
  },
  "title": "Deployment status",
  "createdAt": "2026-09-13T09:00:00Z",
  "content": {},
  "view": {}
}
```

### 4.1 Required fields

| Field | Meaning |
| --- | --- |
| `specVersion` | SafeArtifact specification version. Exactly `"0.1"` in this draft. |
| `id` | Opaque artifact identifier. It MUST be unique within its producer's scope. |
| `type.name` | Namespaced Artifact Type name. |
| `type.version` | Exact immutable type version. Version ranges are forbidden. |
| `type.digest` | Digest of the canonical Artifact Type Definition. |
| `title` | Human-readable artifact title. It is always visibly rendered. |
| `createdAt` | RFC 3339 timestamp. It is always visibly rendered. |
| `content` | JSON value validated by the referenced `contentSchema`. |

### 4.2 Optional fields

| Field | Meaning |
| --- | --- |
| `view` | Inline View Definition, if the Artifact Type allows custom views. |
| `producer` | Visible producer name and optional version. |
| `expiresAt` | RFC 3339 timestamp after which a viewer refuses normal rendering. |

Unknown top-level fields MUST be rejected in v0.1.

All textual top-level metadata MUST be shown by the viewer in a permanent visible header or footer. The viewer may style metadata with lower emphasis, but it may not conceal it.

## 5. Artifact Type Definition

```json
{
  "kind": "safeartifact/type-definition",
  "specVersion": "0.1",
  "name": "example.status-report",
  "version": "1.0.0",
  "contentSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "required": ["summary", "services"],
    "properties": {
      "summary": { "type": "string", "maxLength": 4000 },
      "services": {
        "type": "array",
        "maxItems": 100,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["name", "status"],
          "properties": {
            "name": { "type": "string", "maxLength": 200 },
            "status": {
              "type": "string",
              "enum": ["healthy", "degraded", "down"]
            }
          }
        }
      }
    }
  },
  "allowCustomView": true,
  "defaultView": {}
}
```

### 5.1 Type rules

- `name` and `version` together identify an immutable definition.
- Publishing different bytes under an existing name and version is forbidden.
- Artifacts pin the canonical definition using `digest`.
- Type Definitions MUST validate against the SafeArtifact meta-schema.
- Recursive schemas and remote `$ref` are forbidden in v0.1.
- Local `$defs` and local `$ref` are allowed with bounded resolution.
- Schema annotations are not executable and cannot change viewer behavior.
- The registry MUST reject schemas whose possible valid instances exceed platform limits.
- `defaultView`, when present, MUST pass View Definition validation and coverage validation against representative and boundary instances.

A registry may contain built-in types and third-party types. Registration does not make a type trusted; it only gives the definition an immutable identity.

## 6. View Definition

A View Definition is a tree made from an allowlist of component nodes.

```json
{
  "kind": "stack",
  "gap": "medium",
  "children": [
    {
      "kind": "text",
      "value": { "path": "/summary" },
      "emphasis": "lead"
    },
    {
      "kind": "table",
      "rows": { "path": "/services" },
      "columns": [
        {
          "header": "Service",
          "value": { "path": "/name" }
        },
        {
          "header": "Status",
          "value": { "path": "/status" }
        }
      ]
    }
  ]
}
```

Paths use RFC 6901 JSON Pointer. A path in a repeating context is relative to the current item. Missing paths are validation errors.

### 6.1 v0.1 component allowlist

| Component | Purpose |
| --- | --- |
| `stack` | Vertical grouping |
| `grid` | Responsive columns that collapse vertically on narrow screens |
| `section` | Visible titled grouping |
| `heading` | Heading levels 1–6 |
| `text` | Plain text |
| `markdown` | Safe Markdown subset |
| `code` | Visible preformatted text |
| `number` | Locale-neutral or viewer-formatted number |
| `boolean` | Visible true/false value |
| `dateTime` | Visible timestamp |
| `link` | Visible URL and label |
| `list` | Ordered or unordered repeated values |
| `keyValue` | Visible label/value pairs |
| `table` | Tabular repeated objects |
| `divider` | Non-semantic separator |
| `json` | Canonical visible rendering of a selected subtree |

A component's schema is closed: unknown properties are rejected.

### 6.2 Styling

Only semantic style tokens defined by the viewer are allowed, such as:

- `emphasis`: `normal`, `lead`, or `muted`;
- `tone`: `neutral`, `info`, `success`, `warning`, or `danger`;
- `gap`: `none`, `small`, `medium`, or `large`;
- `columns`: an integer from 1 through 4.

The following are forbidden:

- arbitrary CSS or class names;
- arbitrary colors, opacity, fonts, sizes, coordinates, transforms, or z-index;
- absolute or fixed positioning;
- negative spacing;
- clipping and overflow that can hide content;
- conditional visibility;
- user-defined responsive rules;
- animations supplied by the artifact.

A viewer owns the concrete styling and MUST maintain WCAG AA text contrast at minimum.

### 6.3 Markdown profile

The v0.1 Markdown component supports paragraphs, emphasis, strong emphasis, lists, blockquotes, inline code, fenced code blocks, and links.

Raw HTML, images, embedded media, directives, footnotes with hidden bodies, and inline styles are forbidden. Link destinations are rendered visibly next to link labels unless they are identical.

### 6.4 Links and actions

v0.1 supports navigation links only.

- Schemes are limited to `https`.
- The full destination is visible.
- Links open with `noopener` and `noreferrer`.
- Forms, mutations, callbacks, commands, downloads, and artifact-defined network requests are forbidden.

## 7. Canonical fallback view

Every conforming viewer MUST implement a canonical fallback that:

1. visibly renders the artifact title, type, version, ID, timestamps, and producer;
2. recursively renders every value under `content`;
3. preserves object keys and array order;
4. renders complete strings without silent truncation;
5. distinguishes strings, numbers, booleans, and null;
6. detects cycles defensively even though JSON cannot encode them;
7. never interprets content as HTML.

The fallback is used when:

- no View Definition exists;
- the View Definition is invalid;
- visibility coverage fails;
- the requested component is unsupported;
- rendering exceeds a safety budget.

The fallback is a successful safe rendering, not an error page.

## 8. Text visibility coverage

Visibility is a data-level invariant, not a best-effort visual guideline.

### 8.1 Coverage set

After schema validation, the validator walks the artifact and creates a set containing:

- every string leaf under `content`;
- `title`;
- every optional textual metadata value;
- the visible form of `id`, type name, type version, and timestamps.

Each member is identified by its absolute JSON Pointer, so duplicate string values remain distinct obligations.

### 8.2 Binding coverage

The viewer expands repeats and resolves every View Definition binding. A text obligation is covered only when its complete value is emitted into a visible text node.

A visual representation does not cover its source value. For example, a status badge must also contain its visible text, and a chart would require a visible data table. Charts are deferred from v0.1.

A value may be rendered more than once. Every obligation must be rendered at least once.

### 8.3 Runtime visibility audit

After rendering, the viewer MUST audit every emitted text node:

- it participates in normal document layout;
- it has non-zero dimensions;
- it is not clipped, covered, transparent, or off-screen by construction;
- it meets the minimum contrast requirement;
- its complete value is reachable by ordinary scrolling;
- no ancestor hides or collapses it.

Because artifacts cannot supply CSS, this audit mainly detects viewer regressions. A conformance test suite MUST include adversarial long strings, bidirectional text, Unicode controls, nested arrays, and narrow viewports.

### 8.4 Failure behavior

If coverage or visibility fails, the viewer discards the custom view and uses the canonical fallback. If the fallback cannot render safely, the viewer rejects the artifact.

## 9. Validation and rendering pipeline

A viewer processes an artifact in this order:

1. Read at most the configured byte limit.
2. Parse strict UTF-8 JSON and reject duplicate object keys.
3. Validate the SafeArtifact envelope.
4. Resolve the exact Type Definition by name, version, and digest.
5. Validate `content` against `contentSchema`.
6. Select the inline view, default view, or canonical fallback.
7. Validate the View Definition against its closed schema.
8. Resolve bindings and run coverage validation.
9. Build an internal, typed render tree.
10. Render using trusted components and text APIs such as `textContent`.
11. Run the runtime visibility audit.
12. Expose export or navigation controls owned only by the viewer.

No step evaluates artifact content as code or markup.

## 10. Resource limits

A default v0.1 deployment profile enforces:

| Resource | Limit |
| --- | ---: |
| Encoded artifact size | 1 MiB |
| JSON nesting depth | 32 |
| Total JSON nodes | 50,000 |
| Single string length | 100,000 Unicode scalar values |
| Array length | 10,000 |
| Object properties | 1,000 |
| View nodes after repeat expansion | 100,000 |
| Schema validation time | 250 ms target, 1 s hard limit |
| Rendering time | 1 s target, 5 s hard limit |

Deployments MAY choose lower limits. Higher limits require a different named deployment profile and dedicated conformance testing.

The earlier proof-of-concept retention target of ten days is a storage policy, not part of the portable artifact format.

## 11. Browser isolation

A web viewer SHOULD use a dedicated origin and MUST use a restrictive Content Security Policy equivalent to:

```text
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self';
font-src 'self';
connect-src 'self';
object-src 'none';
frame-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
```

Additional requirements:

- Never use `innerHTML` with artifact-controlled data.
- Do not load artifact-selected fonts, styles, images, scripts, frames, or media.
- Do not persist an artifact in browser storage unless explicitly requested by the user.
- Do not expose secrets, credentials, or privileged APIs to the viewer origin.
- Treat exports as newly generated data, not as trusted source files.

## 12. Storage and encrypted transport

The core specification is storage-neutral. An artifact may be served from an API, object storage, or a Git-backed sharing mechanism.

A public Git or GitHub Pages transport MUST NOT be treated as confidential storage. Confidential artifacts require an encrypted envelope:

```json
{
  "kind": "safeartifact/encrypted-envelope",
  "specVersion": "0.1",
  "algorithm": "X25519-HKDF-SHA256+A256GCM",
  "recipientKeyId": "sha256-...",
  "ephemeralPublicKey": "...",
  "nonce": "...",
  "ciphertext": "..."
}
```

Encryption is an optional transport profile and will need a separate cryptographic specification before implementation. The algorithm identifiers above are provisional. A viewer MUST NOT invent fallback cryptography when it encounters an unsupported profile.

Public-key encryption protects artifact contents at rest in a public Git-backed transport; it does not hide repository metadata, access times, artifact size, or decrypted content from the recipient's device.

## 13. Versioning

- `specVersion` changes when the envelope, validation, or rendering contract changes.
- Artifact Type versions follow semantic versioning by convention, but artifacts always pin exact versions and digests.
- Existing Type Definition bytes are immutable.
- Viewers reject unsupported major specification versions.
- New component kinds require a new SafeArtifact specification version or an explicitly negotiated extension profile.
- Unknown fields and unknown component kinds fail closed in v0.1.

## 14. Conformance requirements

A conforming producer MUST:

- emit strict JSON;
- reference an immutable Type Definition;
- stay within the declared resource profile;
- avoid executable or externally loaded content.

A conforming registry MUST:

- validate Type Definitions against the meta-schema;
- preserve immutable versions;
- serve definitions by digest;
- reject unsupported or unbounded schema features.

A conforming viewer MUST:

- validate before rendering;
- implement the canonical fallback;
- enforce complete text coverage;
- render through trusted primitives only;
- apply browser isolation and resource limits;
- fail closed without losing the ability to show safe canonical JSON when possible.

## 15. Example

Artifact:

```json
{
  "specVersion": "0.1",
  "id": "deploy-2026-09-13-001",
  "type": {
    "name": "example.status-report",
    "version": "1.0.0",
    "digest": "sha256-example"
  },
  "title": "Production deployment",
  "createdAt": "2026-09-13T09:00:00Z",
  "producer": "deployment-agent/1.4.0",
  "content": {
    "summary": "Deployment completed with one degraded service.",
    "services": [
      { "name": "API", "status": "healthy" },
      { "name": "Worker", "status": "degraded" }
    ]
  }
}
```

With no inline view, the type's default view may render the summary and table. The viewer's permanent metadata region renders all envelope text. Coverage succeeds because every string under `content` appears visibly in the summary or table.

## 16. v0.1 non-goals

The first implementation deliberately excludes:

- JavaScript and user-defined expressions;
- arbitrary HTML, CSS, and SVG;
- images and embedded media;
- charts without an always-visible source table;
- forms and mutations;
- live data bindings;
- artifact-selected network requests;
- conditional or collapsed sections;
- cross-artifact composition;
- offline cryptographic identity and signatures beyond digest pinning.

## 17. Open decisions

These choices should be resolved before implementation:

1. Whether inline custom views are enabled by default or require explicit opt-in by each Artifact Type.
2. The exact supported subset and implementation library for JSON Schema Draft 2020-12.
3. Whether numbers, booleans, and null should receive the same mandatory coverage guarantee as strings. The recommended answer is yes.
4. Whether encrypted transport belongs in v0.1 or a separate `safeartifact-encryption` specification.
5. The registry naming authority for type names.
6. Whether ten-day retention and the 1 MiB cap are universal product rules or deployment-profile defaults.
7. The canonical JSON serialization used for type digests.
8. Whether artifact titles and producer metadata belong inside `content` to simplify the coverage model.
