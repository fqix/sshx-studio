# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Host groups: organize hosts into nestable folders in the tree. Create, rename and delete groups, move hosts and groups by drag and drop or **Move to Group…**, and pick the group in the host editor. Deleting a group keeps its hosts.
- Several terminals in one session tab, each its own shell on the same connection: **＋** in the terminal tab strip or **New Terminal** in the editor title bar. **Duplicate Session** opens the host in a new tab with its own connection.

## [0.2.0] - 2026-10-13

### Fixed

- An unreachable SSH agent (for example a stale `SSH_AUTH_SOCK` or `IdentityAgent`) no longer fails the connection; it is skipped and the next authentication method is tried.
- Keyboard-interactive authentication was never attempted; servers that offer it now get it before password authentication.
- **Generate key pair** in the host editor could produce an unusable Ed25519 key (about 1 in 256 times) because of a bug in the ssh2 key generator. Malformed keys are now discarded and generated again.

### Changed

- The connection log names each authentication attempt and reports when the server rejects it or asks for more.
- Secret storage is described as the system credential store (macOS Keychain, Windows Credential Manager, libsecret on Linux) instead of "keychain", and the README notes that Linux needs a running keyring.

## [0.1.0] - 2026-10-12

First release.

### Added

- Session tab with an xterm.js terminal and an SFTP file browser side by side.
- File operations: browse, rename, delete, new folder, `cd` the terminal into a folder, edit remote files in VS Code (saved back on save).
- Uploads by dialog, drag and drop, and **Upload to SSH Host…** in the Explorer context menu; downloads of files and folders.
- Transfer list with a progress bar per file or folder, speed, time left, parallel transfers and cancellation.
- Hosts stored in a local SQLite database, with first-run import from `~/.ssh/config` (including port forwards).
- Host editor with password, key file, agent and keychain-stored key authentication, key pair generation, and **Test connection**.
- Credentials kept in the OS keychain through VS Code SecretStorage, with an offer to save passwords typed at login.
- Port forwarding per host: local (`-L`), remote (`-R`) and dynamic SOCKS5/SOCKS4a (`-D`), with auto-start.
- Agent forwarding and X11 forwarding (with cookie spoofing).
- ProxyJump chains, ProxyCommand and `known_hosts` verification.
- English and Simplified Chinese.
- One VSIX for macOS, Linux (glibc and musl) and Windows on x64 and arm64.

[Unreleased]: https://github.com/fqix/sshx-studio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/fqix/sshx-studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fqix/sshx-studio/releases/tag/v0.1.0
