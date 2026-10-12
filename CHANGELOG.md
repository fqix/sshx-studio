# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/fqix/sshx-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fqix/sshx-studio/releases/tag/v0.1.0
