---
name: react-frontend
description: Build or extend client-side TypeScript React applications with Vite, React Router, TanStack Query and explicit feature-owned UI and API code. Use for browser dashboards and SPAs adopting this architecture.
---

# React frontend — v0.1.0

## Decisions

React, TypeScript strict, Vite, React Router (declarative routing), TanStack Query for remote state, Zod for API response validation, native fetch, CSS Modules for component styles, global CSS variables for design tokens. Use Vitest, React Testing Library and Playwright for critical flows. No Next.js, Redux, MobX, Axios, CSS-in-JS, global event bus or custom component framework in this profile. SSR and SEO-heavy public sites are outside scope.

## Layout

    src/
      main.tsx
      app/
        App.tsx
        providers.tsx
        routes.tsx
        tokens.css
      api/
        request.ts
      components/
        Button.tsx
        Button.module.css
      features/
        tasks/
          TasksPage.tsx
          TaskList.tsx
          tasks.api.ts
          tasks.dto.ts
          tasks.queries.ts
          TasksPage.module.css
          TasksPage.test.tsx
    e2e/

Register routes explicitly. Keep pages, API methods, DTOs, query keys and UI in their feature. Only genuinely shared UI goes in components/. Features do not import each other's internals; compose pages in app/. Use named exports except where tooling requires otherwise.

## State and data

- Local UI state: useState; derived state: calculate during render. URL state: search params. Server state: TanStack Query. Context only for low-frequency cross-cutting values such as authentication/theme.
- Define feature-owned query key factories that include filters and identity/scope when relevant. Invalidate targeted keys after mutation. Clear cached private data at logout or identity/tenant changes. Never copy query data into useState just to render it.
- API functions use the application-owned request helper and validate responses with Zod. No fetch directly inside components or useEffect for routine server data.
- Render loading, empty, error and success explicitly. Preserve data on background refetch; disable duplicate mutation submission. Do not retry non-idempotent mutations automatically.
- Use same-origin relative URLs in production; configure Vite proxy locally. For cookie sessions use server-provided CSRF protection on unsafe methods. Do not store credentials in localStorage or put secrets in VITE_* variables.
- Build accessible UI with semantic HTML, labels, keyboard support, visible focus, and responsive layout. Use CSS Modules; tokens are CSS variables. Do not create a design system before repeated use exists.

## Workflow

Read [API and query example](references/api-example.md). Add DTO, API function, query definition, page/component and tests in that order. Register route in app/routes.tsx. Test rendering and actions rather than component internals; mock network boundaries and exercise real API in critical end-to-end flows. Run typecheck, unit tests, production build and relevant Playwright tests.

## Done

Every network operation is traceable to a feature API module; remote state is not duplicated; loading/error/empty states are intentional; there are no imports from the skill repository at runtime. Document deviations and avoid unrelated rewrites.
