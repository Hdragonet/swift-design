# Repository Guidelines

## Project Structure & Module Organization
This repository is a Vue 3 + Vite + TypeScript app.

- `src/main.ts`: app bootstrap.
- `src/App.vue`: root layout.
- `src/views/`: feature editors (`UseCaseEditor.vue`, `EREditor.vue`, `DBEditor.vue`, `FuncStructEditor.vue`).
- `src/stores/project.ts`: Pinia store and shared domain types.
- `src/router/index.ts`: route definitions.
- `src/assets/` and `public/`: static styles and assets.
- `.github/workflows/deploy.yaml`: CI build and deployment for the `prod` branch.

Keep new feature UI in `src/views/`, and move reusable logic into `src/stores/` or composables as complexity grows.

## Build, Test, and Development Commands
Use Node `20.x` (see `package.json` engines).

- `npm install`: install dependencies.
- `npm run dev`: start Vite dev server with hot reload.
- `npm run type-check`: run `vue-tsc --build`.
- `npm run build`: type-check and build production bundle into `dist/`.
- `npm run preview`: serve the built bundle locally for validation.

Example flow: `npm run type-check && npm run build`.

## Coding Style & Naming Conventions
- Use TypeScript for logic and Vue SFCs with `<script setup lang="ts">`.
- Indentation: 2 spaces in `.vue` files; follow existing style per file and avoid mixed formatting in a single edit.
- Vue components: `PascalCase.vue` (e.g., `DBEditor.vue`).
- Store/composable functions and variables: `camelCase`; interfaces/types: `PascalCase`.
- Keep domain model types centralized in `src/stores/project.ts` unless a module clearly owns them.

No ESLint/Prettier config is currently committed; keep diffs small and consistent with surrounding code.

## Testing Guidelines
There is no automated test framework configured yet. Minimum quality gate is:

- `npm run type-check` passes.
- `npm run build` succeeds.
- Manual verification of affected editor views and route navigation.

If you add tests, prefer Vitest + Vue Test Utils with `*.spec.ts` naming under `src/**/__tests__/`.

## Commit & Pull Request Guidelines
Recent history uses concise Conventional Commit style (for example, `feat: add deploy.yaml`, `feat: ...`).

- Commit format: `type: short summary` (`feat`, `fix`, `refactor`, `chore`, `docs`).
- Keep each commit focused on one logical change.
- PRs should include: purpose, key changes, validation steps run, and screenshots/GIFs for UI updates.
- Link related issues and highlight any deployment impact (especially changes touching `.github/workflows/deploy.yaml` or `prod` branch behavior).
