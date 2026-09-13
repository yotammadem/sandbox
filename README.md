# Sandbox monorepo

A lightweight workspace for small applications, shared packages, and disposable experiments.

## Structure

- `apps/` — runnable applications
- `packages/` — reusable libraries shared by applications
- `experiments/` — short-lived proofs of concept
- `docs/` — specifications and design notes

## Specifications

- [SafeArtifact draft specification](docs/safe-artifact-spec.md)

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Getting started

```bash
npm install
npm test
npm start
```

The starter app in `apps/hello` imports `@sandbox/shared`, demonstrating local package linking through npm workspaces.

## Adding a project

Create a directory with its own `package.json` under `apps/`, `packages/`, or `experiments/`. npm will discover it on the next `npm install`.

Keep dependencies and scripts inside the workspace that owns them. Add tooling at the root only when several projects benefit from it.
