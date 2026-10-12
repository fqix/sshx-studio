# Contributing to SSHX Studio

Thanks for helping! This guide covers setting up the project, how it's put together, and what a pull request needs.

## Reporting bugs and requesting features

Open an [issue](https://github.com/fqix/sshx-studio/issues). For bugs, please include:

- VS Code version, OS and architecture
- What you did, what you expected, and what happened
- The **SSHX Studio** output channel (View → Output → SSHX Studio). Remove host names and addresses you don't want to share.

Security issues should be reported privately instead — see [SECURITY.md](SECURITY.md).

## Development setup

Requirements: **Node.js 22+** (see `.nvmrc`) and VS Code 1.101+. No C++ toolchain is needed.

```bash
git clone https://github.com/fqix/sshx-studio.git
cd sshx-studio
npm install          # also installs webview-ui/ dependencies
npm run build
```

Press **F5** in VS Code to start an Extension Development Host with the extension loaded.

| Command | What it does |
|---|---|
| `npm run build` | Build the extension (esbuild) and the webview (Vite) |
| `npm run watch` | Rebuild the extension on change |
| `npm run dev:webview` | Run the webview UI in a browser with a mock backend — `http://localhost:5173/?view=session`, `?view=hostEditor&lang=zh-cn`, add `&demo=1` for sample data |
| `npm run typecheck` | Type-check the extension and the webview |
| `npm test` | Integration tests against an in-process SSH/SFTP server |
| `npm run test:e2e` | Run the extension inside a real VS Code (downloads one, or set `VSCODE_EXECUTABLE`) |
| `npm run l10n` | Re-extract translatable strings and check every language is complete |
| `npm run package` | Build the `.vsix` |

## How it's put together

```
shared/protocol.ts     Messages between the extension and the webview (typed on both sides)
src/                   Extension (Node.js)
  extension.ts         Wiring
  commands/            Command handlers
  config/              ssh_config parsing and option resolution
  ssh/                 Connecting, authentication, known_hosts, key generation, ProxyJump/ProxyCommand
  sftp/                Promise-based SFTP and transfer planning
  forward/             -L / -R / -D forwards, SOCKS server, ForwardManager
  x11/                 X11 forwarding with cookie spoofing
  storage/             SQLite, migrations, repositories, keychain secrets, ssh config import
  hosts/               Host editor panel, validation, connection test
  session/             Session tab: terminal, files, transfer queue, remote editing
  views/hostTree/      The Hosts tree
webview-ui/            React + Vite app for the session tab and the host editor
l10n/, package.nls*    Translations
test/                  Tests; test/vscode/ runs inside a real VS Code
```

A few design points worth knowing:

- **Nothing in `src/ssh`, `src/sftp`, `src/forward`, `src/x11` or `src/storage` imports `vscode`.** That keeps them testable with plain Node — please keep it that way and put VS Code UI in `commands/`, `hosts/`, `session/` or `views/`.
- **SQLite** uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), which ships prebuilt N-API binaries for every platform. The build copies all of them to `dist/native/` (and checks each binary's header), and `src/storage/nativeBinding.ts` loads the right one at runtime — so a single VSIX works on every platform and survives Electron upgrades.
- **Secrets never go into SQLite.** Passwords, passphrases and stored keys go through `HostSecretStore` (VS Code SecretStorage).
- **Schema changes** are new entries at the end of `MIGRATIONS` in `src/storage/migrations.ts` — never edit an existing one.

## Tests

- `npm test` starts an in-process SSH server (with SFTP, `tcpip-forward`, X11 and agent requests) and covers connecting, ProxyJump/ProxyCommand, host keys, credentials, all forward types, SFTP transfers and cancellation, storage, and import.
- `npm run test:e2e` activates the extension in a real VS Code: it opens the native SQLite database, imports a fixture ssh config, runs a forward, opens a session tab and uploads a folder.

New behaviour should come with a test. Bug fixes should come with a test that failed before the fix.

## Translations

User-facing strings go through `t()` (`src/i18n.ts`) in the extension and `t()` (`webview-ui/src/i18n`) in the webview. To add a language:

1. Copy `package.nls.zh-cn.json` → `package.nls.<locale>.json` and `l10n/bundle.l10n.zh-cn.json` → `l10n/bundle.l10n.<locale>.json`, and translate the values.
2. Add `webview-ui/src/i18n/<locale>.ts` (it's typed, so missing keys fail the build) and register it in `webview-ui/src/i18n/index.ts`.
3. Run `npm run l10n` — it must report 0 missing.

## Pull requests

Before opening a PR:

- [ ] `npm run typecheck`, `npm test` and `npm run l10n` pass
- [ ] New or changed behaviour is covered by tests
- [ ] New user-facing strings are translated (or at least listed in the PR so someone can)
- [ ] `CHANGELOG.md` has an entry under **Unreleased**

CI runs the tests on macOS (Intel and Apple Silicon), Linux (x64, arm64, Alpine) and Windows, plus the end-to-end test in a real VS Code.

## Releasing

Maintainers: bump `version` in `package.json`, move the **Unreleased** changelog entries under the new version, then publish a GitHub release tagged `v<version>`. The `Release` workflow builds the VSIX, publishes it to the VS Code Marketplace and Open VSX, and attaches it to the release.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
