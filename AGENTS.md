# Repository Guidelines

This repository is a KeyFerry commercial fork of upstream `cc-switch`. The
long-term goal is to keep upstream updates easy to replay while making KeyFerry
the only supported provider configuration path.

## Project Structure & Module Organization

This is a Tauri 2 desktop app with a React 18/TypeScript renderer. Frontend source lives in `src/`: UI in `src/components/`, hooks in `src/hooks/`, API wrappers in `src/lib/api/`, query logic in `src/lib/query/`, config presets in `src/config/`, and locales in `src/i18n/locales/`. Rust backend code lives in `src-tauri/src/`, organized around commands, services, database DAOs, proxy logic, MCP sync, deeplinks, and session management. Frontend tests are in `tests/`; Rust integration tests are in `src-tauri/tests/`. Assets live in `assets/`; docs and release notes live in `docs/`.

KeyFerry-specific implementation notes live in `docs/keyferry-development.md`.
Update that file whenever the KeyFerry login flow, provider lock boundary, or
database compatibility story changes.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies from `pnpm-lock.yaml`.
- `pnpm dev`: run the full Tauri app in development mode.
- `pnpm dev:renderer`: run only the Vite renderer.
- `pnpm typecheck`: run TypeScript checks with `tsc --noEmit`.
- `pnpm format` / `pnpm format:check`: write or verify Prettier formatting for frontend files.
- `pnpm test:unit`: run Vitest tests once.
- `pnpm test:unit --coverage`: generate coverage reports.
- `pnpm build`: build the production Tauri app.
- `cd src-tauri && cargo fmt && cargo clippy && cargo test`: format, lint, and test Rust code.

## Coding Style & Naming Conventions

Use TypeScript, React function components, and existing path alias imports such as `@/lib/api`. Keep component files in PascalCase (`ProviderCard.tsx`) and hooks in camelCase starting with `use` (`useSettings.ts`). Tests should mirror the unit under test and use `.test.ts` or `.test.tsx`. Prettier controls frontend formatting; `cargo fmt` controls Rust formatting. Prefer existing service, DAO, command, and hook patterns before adding abstractions.

## Testing Guidelines

Frontend tests use Vitest, jsdom, Testing Library, and MSW mocks from `tests/msw/`. Add or update tests near the related suite when changing hooks, components, API wrappers, or import/export behavior. Rust changes in commands, services, database, proxy, MCP, deeplink, or session logic should include `cargo test` coverage.

## Commit & Pull Request Guidelines

Commit history follows Conventional Commits, often scoped: `fix(claude): ...`, `feat(provider): ...`, `docs(readme): ...`. Keep subjects imperative and focused. Before opening a PR, run `pnpm typecheck`, `pnpm format:check`, `pnpm test:unit`, and relevant Rust checks. PR descriptions should summarize behavior changes, link issues, call out config or migration impact, and include screenshots for UI changes.

## Agent-Specific Instructions

Do not use the system `python3` command in this repository; use `python` when a Python command is necessary.

## KeyFerry Product Boundary

KeyFerry is the product name. Do not rename the product to `sozdata`; `https://x.sozdata.com` is only the fixed NewAPI gateway.

KeyFerry-only mode is intentional:

- KeyFerry login is the only supported way to create providers.
- Users may choose which of Claude, Codex, Gemini, OpenCode, and OpenClaw are managed by KeyFerry during login or reconfiguration, with at least one app enabled.
- Users may edit and test the KeyFerry-managed providers.
- After login, the KeyFerry entry should show account status, logout, and reconfigure actions instead of the login form.
- Keep the `default` official Claude, Codex, and Gemini providers visible as fallback channels users can switch back to.
- Users must not be able to add, delete, import, restore, or create providers outside KeyFerry login.
- Backend guards matter more than frontend hiding. Any new command that can mutate providers, universal providers, live config, deep links, imports, or database restore must respect the KeyFerry lock.
- Claude, Codex, Gemini, OpenCode, and OpenClaw are the active app surfaces. OpenCode/OpenClaw are visible when selected in the KeyFerry scope.
- Never print, store in docs, or commit real NewAPI passwords, cookies, or token keys.

Core KeyFerry files:

- `src-tauri/src/commands/keyferry.rs`
- `src/components/keyferry/KeyFerryLoginPanel.tsx`
- `src/lib/api/keyferry.ts`
- `src/App.tsx`
- `src-tauri/src/commands/provider.rs`
- `src-tauri/src/commands/deeplink.rs`
- `src-tauri/src/commands/import_export.rs`
- `src-tauri/src/tray.rs`
- `docs/keyferry-development.md`

## Upstream Development Boundary

Treat upstream `cc-switch` as a moving base. Keep KeyFerry customizations small, explicit, and easy to reapply.

- Prefer wrapper commands, small guards, and adapter modules over broad edits to upstream services.
- Do not reformat, rename, or refactor unrelated upstream files just because they are nearby.
- Do not remove upstream features unless they conflict with the KeyFerry-only product boundary; hide or guard them instead when possible.
- Keep custom constants centralized and searchable: `KEYFERRY_ONLY_MODE`, `KEYFERRY_GATEWAY_URL`, and `KEYFERRY_PROVIDER_ID`.
- When changing an upstream-owned flow, add a short note in `docs/keyferry-development.md` explaining why the fork diverges.
- Avoid changing public data shapes unless required. If a data contract changes, update backend, frontend API wrappers, tests, and docs together.
- Assume future upstream merges will touch provider, proxy, database, and session code. Keep KeyFerry logic out of deep service layers unless there is no safe command/UI boundary.

When pulling or replaying upstream changes:

- Inspect upstream database `SCHEMA_VERSION` and migration functions before running the app against a real user database.
- Re-check all provider mutation entry points for KeyFerry lock coverage.
- Re-check new app surfaces, tray entries, settings panels, import/export paths, and deep links.
- Run focused tests first, then broader checks as needed.
- Record notable conflicts or decisions in `docs/keyferry-development.md`.

## Database Safety

User data lives under `~/.cc-switch/`, especially `~/.cc-switch/cc-switch.db`.

- Never delete or replace a user database to fix a startup issue.
- Never manually downgrade `PRAGMA user_version`.
- If the app reports "database version too new", first compare local `SCHEMA_VERSION` with upstream and backfill missing migrations.
- Keep migrations idempotent with `CREATE TABLE IF NOT EXISTS` and `add_column_if_missing` where possible.
- Preserve future-version protection: databases newer than the code should fail clearly instead of being mutated blindly.
- Back up the whole config directory before destructive or uncertain database work.

The current fork supports database schema version 10. WebDAV database compatibility is separate; do not bump `DB_COMPAT_VERSION` just because `SCHEMA_VERSION` changes.

## Sustainable Change Checklist

Before finishing a change, choose the smallest useful verification set:

- Frontend type/API/UI changes: `pnpm typecheck` and relevant Vitest suites.
- KeyFerry login changes: `cargo test --manifest-path src-tauri/Cargo.toml keyferry`.
- Database migration changes: `cargo test --manifest-path src-tauri/Cargo.toml schema_migration`.
- Renderer integration changes: `pnpm build:renderer`.
- App startup or database compatibility changes: run `pnpm dev`, confirm startup, then stop the dev process.

Known caveat: `cargo fmt --manifest-path src-tauri/Cargo.toml --check` may fail on pre-existing upstream formatting in files unrelated to a task. Do not churn unrelated files solely to make that command green unless the task is explicitly about formatting.
