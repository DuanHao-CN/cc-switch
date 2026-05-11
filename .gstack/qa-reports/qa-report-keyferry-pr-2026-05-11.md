# QA Report: KeyFerry Provider Lock PR

Date: 2026-05-11
Branch: `codex/keyferry-provider-lock`
PR: `DuanHao-CN/cc-switch#1`
Scope: Diff-aware QA against `docs/keyferry-prd.md`, especially sections 7.4, 7.5, and 11.
Health Score: 94/100 after fixes

## Summary

- Issues found: 1
- Fixes applied: 1 verified
- Deferred issues: 0 product issues
- Browser smoke: homepage/login surface verified with local QA harness; settings-page browser smoke was blocked by incomplete temporary harness providers, so settings behavior was verified through component/integration tests and focused Rust tests.

## Changes Tested

- KeyFerry-only settings lock no longer hides the entire advanced settings data group.
- SQL import is hidden while SQL export remains available.
- Backup restore is hidden while manual backup and backup settings remain available.
- WebDAV download restore is hidden while WebDAV configuration, test, save, and upload remain available.
- Backend WebDAV download restore now rejects in KeyFerry-only mode.

## ISSUE-001: Safe Advanced Tools Hidden With Provider Restore Paths

Severity: High
Category: Functional / Product Boundary
Status: verified

PRD references:

- `docs/keyferry-prd.md` 7.5: settings page must not hide all advanced features in KeyFerry-only mode.
- `docs/keyferry-prd.md` 7.4: SQL import and database restore must not bypass provider boundaries.
- `docs/keyferry-prd.md` 11: backend guards matter more than frontend hiding.

Observed before fix:

- `allowConfigImportExport=false` hid the data/import-export, backup/restore, and WebDAV sync settings as one group.
- This locked safe user capabilities such as SQL export, manual backup, backup settings, WebDAV configuration, and WebDAV upload.
- WebDAV download restore still needed an explicit backend guard to avoid restoring database/provider state through remote sync.

Fix:

- Split settings locks into `allowConfigImport` and `allowDatabaseRestore`.
- Keep advanced settings sections visible.
- Hide SQL import/clear, backup restore, and WebDAV download restore only.
- Add `ensure_webdav_download_allowed()` in `webdav_sync_download`.
- Document the boundary in `docs/keyferry-development.md`.

Verification:

- `tests/components/SettingsDialog.test.tsx` asserts safe tools remain visible while restore paths are locked.
- `tests/components/ImportExportSection.test.tsx` asserts export remains available when import is locked.
- `tests/components/WebdavSyncSection.test.tsx` asserts WebDAV config/test/save/upload remain available and download is hidden.
- `cargo test --manifest-path src-tauri/Cargo.toml webdav` includes `keyferry_only_mode_blocks_webdav_download_restore`.

## Browser Evidence

Local harness: `/private/tmp/cc-switch-qa-harness`

- Homepage screenshot captured at `/private/tmp/cc-switch-qa-harness/home.png`.
- Verified visible first screen: KeyFerry title, `https://x.sozdata.com`, five client switches, disabled login button before credentials, and unconfigured status.
- Follow-up settings smoke was attempted with the same harness. It required extra app-level providers (`UpdateProvider`, `ThemeProvider`, `Toaster`) and still remained harness-blocked rather than product-blocked. No product bug was filed from that harness issue.

## Commands Run

```bash
git diff --check
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm build:renderer
cargo test --manifest-path src-tauri/Cargo.toml keyferry
cargo test --manifest-path src-tauri/Cargo.toml schema_migration
cargo test --manifest-path src-tauri/Cargo.toml webdav
```

Result:

- Frontend: 34 test files passed, 216 tests passed.
- Rust focused suites passed: KeyFerry, schema migration, WebDAV.
- Renderer production build passed.

## Ship Readiness

Ready for PR review. The remaining browser harness issue is outside repository source and is covered by direct component/integration/Rust tests for this PR's changed behavior.
