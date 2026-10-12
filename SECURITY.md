# Security Policy

SSHX Studio handles SSH credentials and opens network tunnels, so security reports are taken seriously.

## Supported versions

Security fixes are released for the latest published version. Please update before reporting.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through [GitHub's private vulnerability reporting](https://github.com/fqix/sshx-studio/security/advisories/new).

Include what you can of:

- The affected version and platform
- What an attacker could do, and under which conditions
- Steps to reproduce, or a proof of concept

You can expect an acknowledgement within a few days. Once the issue is confirmed, a fix is prepared and released, and you'll be credited in the advisory unless you'd rather not be.

## Scope

In scope are issues in this extension, for example:

- Credentials leaking to disk, logs, the webview or the network
- Host key verification being bypassed
- Forwarded ports listening more widely than configured
- X11 or agent forwarding exposing more than intended
- Code execution through ssh config contents, file names, or data sent by a server

Vulnerabilities in OpenSSH, ssh2, better-sqlite3 or VS Code itself should be reported to those projects, though a heads-up here is welcome if SSHX Studio is affected.
