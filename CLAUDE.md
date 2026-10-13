# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SSHX Studio is a VS Code extension: an SSH terminal and SFTP file manager in one webview tab, port forwarding (`-L`/`-R`/`-D`), agent/X11 forwarding, ProxyJump/ProxyCommand. Hosts live in a local SQLite DB, secrets in VS Code SecretStorage. Two npm packages: the extension at the root and the React webview in `webview-ui/` (installed by the root `postinstall`).

## Commands

```bash
npm install            # root + webview-ui
npm run build          # esbuild extension → dist/extension.js, Vite webview → dist/webview/
npm run watch          # rebuild extension on change (webview is NOT watched; run build:webview)
npm run typecheck      # tsc for both packages — run after any change; there is no linter
npm test               # bundles test/e2e.ts → out/e2e.js and runs it (in-process SSH/SFTP server)
npm run test:e2e       # builds, then runs the extension inside a real VS Code (VSCODE_EXECUTABLE=… to use a local install)
npm run l10n           # regenerate l10n/bundle.l10n.json and fail on missing translations
npm run dev:webview    # webview in a browser with a mock host: ?view=session|hostEditor &lang=en|zh-cn &demo=1
npm run package        # universal .vsix
```

There is no per-test filter: `test/e2e.ts` starts one SSH server and calls the test groups (`storage.test.ts`, `transfers.test.ts`, `forwarding.test.ts`, `hostEditor.test.ts`) in sequence. To focus on one, temporarily comment out the others in `main()`.

## Architecture

**Layering rule:** `src/ssh`, `src/sftp`, `src/forward`, `src/x11`, `src/config`, `src/storage` (except `databasePath.ts`) must not import `vscode` — the Node test harness loads them directly. VS Code UI lives in `commands/`, `hosts/`, `session/`, `views/`. User-facing strings go through `t()` from `src/i18n.ts`, which wraps `vscode.l10n.t` when available and falls back to plain substitution in tests.

**Connection path:** `HostResolver.resolve(alias)` → `ResolvedHost` → `ssh/connect.ts`. `DatabaseHostResolver` reads the DB row + keychain secrets and falls back to `~/.ssh/config` for unknown aliases (e.g. ProxyJump targets). Both DB rows and ssh_config go through the same `config/resolveOptions.ts`, so token expansion and defaults are identical. `connect.ts` recurses for ProxyJump chains (`forwardOut` through the jump host) or wraps a ProxyCommand process as the socket. ssh2's `readyTimeout` is disabled; `ssh/handshake.ts` runs its own timer that pauses while a `Prompter` dialog is open. A `PromptSession` wraps the prompter per connection and offers to save typed passwords after login.

**Extension ↔ webview:** every message type is in `shared/protocol.ts`, imported by both packages. One Vite bundle serves two pages, chosen by `WebviewConfig.view`. The extension builds its own HTML (`session/webviewHtml.ts`, CSP + nonce) pointing at the fixed asset names from `webview-ui/vite.config.ts`; `webview-ui/index.html` is dev-only. In dev, `webview-ui/src/vscode/mockHost.ts` stands in for the extension.

**Session tab:** `SessionPanel` routes messages to `TerminalChannel` (shell + optional X11), `FileController` (VS Code dialogs + browsing on the main SFTP channel) and `RemoteEditor` (temp copy, upload on save). Uploads/downloads go through `TransferService` → `TransferQueue`: each transfer opens its own SFTP channel, at most 3 run at once, progress is pushed to the webview throttled.

**Storage:** `better-sqlite3` in WAL mode. `esbuild.mjs` copies all 8 prebuilt binaries from `node_modules/better-sqlite3/prebuilds` to `dist/native/` and verifies each binary's header (`scripts/check-native.mjs`); `storage/nativeBinding.ts` picks one at runtime (glibc vs musl detected) and passes it as `nativeBinding`. One universal VSIX, no native compilation anywhere. Other windows' commits are detected by polling `PRAGMA data_version`. Schema changes: append to `MIGRATIONS` in `storage/migrations.ts`, never edit an existing entry.

## Gotchas (each one caused a real bug)

- `AppDatabase.transaction` bodies are synchronous on purpose. An async body holds the write lock across `await` and deadlocks other connections (`SQLITE_BUSY`).
- ssh2 `fastGet`/`fastPut` never call back once their channel is closed, so cancelling must settle the job itself — `TransferQueue` races each job against an abort promise.
- The webview must not gate its `ready` message on `requestAnimationFrame` alone: rAF doesn't fire while the webview isn't rendered, and the session would never connect (`TerminalView` uses a timeout fallback).
- `FileController.whenReady()` waits for the *next* successful SFTP attach; only a failed attach or a failed connection rejects it (reconnecting starts with a `disconnect()` that must not reject waiters).
- X11: the server only ever gets the fake cookie; `x11/x11Forwarder.ts` rewrites the client setup packet with the real `xauth` cookie. In the test server, ssh2 delivers `info.cookie` as a Buffer of hex characters despite its typings.
- `.vscodeignore` is a whitelist (`**` then `!…`). A later exclude cannot remove a file an earlier `!` included, so whitelist by file type.
- README badges: shields.io's VS Code Marketplace badges are retired; use `vsmarketplacebadges.dev` (allowed by vsce).

## Translations

Three places: `package.nls*.json` (manifest), `l10n/bundle.l10n.*.json` (extension `t()` strings — the English source string is the key), `webview-ui/src/i18n/*.ts` (typed; a missing key fails `tsc`). Add strings in all languages and run `npm run l10n`.

## CI and release

`.github/workflows/ci.yml` runs typecheck, l10n, build and tests on darwin x64/arm64, linux x64/arm64, Alpine x64 and win32 x64 (plus `test:e2e` on three OSes), then packages and checks the VSIX contents. `release.yml` runs when a GitHub release is published: it reuses CI, requires the tag to equal `v` + `package.json` version, publishes to the Marketplace via Azure workload identity federation (`marketplace-publish` environment) and to Open VSX via trusted publishing, then attaches the VSIX. To release: bump the version, move CHANGELOG "Unreleased" entries under the new version, push, then publish a GitHub release for tag `v<version>`.
