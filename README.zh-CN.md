<p align="center">
  <img src="media/icon.png" width="96" alt="">
</p>

<h1 align="center">SSHX Studio</h1>

<p align="center">
  SSH 终端、SFTP 文件管理、端口转发 —— 在 VS Code 的同一个标签页里。
</p>

<p align="center">
  <a href="https://github.com/fqix/sshx-studio/actions/workflows/ci.yml"><img src="https://github.com/fqix/sshx-studio/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=fqix.sshx-studio"><img src="https://vsmarketplacebadges.dev/version-short/fqix.sshx-studio.svg?label=VS%20Marketplace&color=0066b8" alt="VS Marketplace"></a>
  <a href="https://open-vsx.org/extension/fqix/sshx-studio"><img src="https://img.shields.io/open-vsx/v/fqix/sshx-studio?label=Open%20VSX" alt="Open VSX"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

![会话标签页：左侧终端，右侧远程文件和传输列表](media/screenshots/session.png)

Remote - SSH 会把 VS Code 变成远程工作区，但很多时候你并不需要这样 —— 只是想在当前项目旁边开一个服务器的终端、看看它的文件、再开个隧道连到它后面的数据库。SSHX Studio 就是为此而做的。

## 功能

**终端和文件在一起**
- 同一个标签页里是完整的 xterm.js 终端和 SFTP 文件浏览器，中间的分隔条可以拖动。
- 终端内查找（⌘F / Ctrl+F），支持区分大小写、全字匹配和正则表达式。
- 同一标签页可开多个终端（共用一条连接），也可复制会话到新标签页。
- 浏览、重命名、删除、新建文件夹，一键让终端 `cd` 到任意目录。
- 双击文件即可在 VS Code 中编辑，保存时自动上传。
- 通过对话框、拖放，或**在资源管理器中右键 → 上传到 SSH 主机…** 上传文件。

**看得见的传输**
- 每个文件 / 文件夹一条进度条，显示速度、剩余时间和文件数。
- 最多 3 个传输并行，各自使用独立的 SFTP 通道，浏览不会卡住。
- 随时暂停 / 继续；连接断开中断的传输，重连后会从断点继续。
- 随时取消，未传完的文件会被清理。

**主机与凭据**
- 首次运行时导入 `~/.ssh/config`（支持 `Include`、通配符、`ProxyJump`、`LocalForward` 等），不会修改你的配置文件。
- 用表单添加 / 编辑主机，保存前可以先**测试连接**。
- 用可嵌套的分组整理主机，可拖拽移动。
- 支持 SSH agent、密钥文件、密码，或保存在系统凭据存储中的密钥（粘贴已有私钥，或生成 Ed25519 / RSA 密钥对）。
- 密码和私钥保存在系统凭据存储中（macOS 钥匙串、Windows 凭据管理器、Linux 上的 libsecret），不会以明文文件存放。

**转发**
- 每台主机可配置端口转发，写法与 `ssh` 参数一致：`-L` 本地、`-R` 远程、`-D` 动态（SOCKS5 / SOCKS4a）。在树中启动、停止，或设为自动启动。
- Agent 转发（`-A`）和 X11 转发（`-X`），X11 采用与 OpenSSH 相同的 cookie 伪造机制。

**连接**
- `ProxyJump` 多级跳板和 `ProxyCommand`（如 `nc`、`cloudflared access ssh`）。
- `known_hosts` 校验，支持哈希条目和 `StrictHostKeyChecking`。

**全平台可用**
- 一个扩展覆盖 macOS、Linux（glibc 和 musl）和 Windows，x64 与 arm64。
- 中英文界面。

<p align="center">
  <img src="media/screenshots/host-editor.png" width="640" alt="主机编辑器：认证方式、转发开关和测试连接成功的结果">
</p>

## 安装

- **VS Code 扩展市场** —— 在扩展视图中搜索 “SSHX Studio”，或运行：
  ```bash
  code --install-extension fqix.sshx-studio
  ```
- **Open VSX**（VSCodium、Cursor、Gitpod 等）—— [open-vsx.org/extension/fqix/sshx-studio](https://open-vsx.org/extension/fqix/sshx-studio)
- **从 Release 安装** —— 在 [GitHub Releases](https://github.com/fqix/sshx-studio/releases) 下载 `.vsix`，然后运行 `code --install-extension sshx-studio-<版本>.vsix`。

需要 VS Code 1.101 及以上。服务器上只需要普通的 SSH 服务（启用 SFTP），无需安装其他东西。

## 快速上手

1. 打开活动栏中的 **SSHX Studio**。首次打开会导入 `~/.ssh/config` 中的主机。
2. 点击 **＋** 添加主机，或右键已有主机进行编辑。保存前可以点击**测试连接**检查配置。
3. 点击主机上的终端图标打开会话：左边终端，右边文件。
4. 点击主机上的 ⇄ 图标添加端口转发。在树中启动 / 停止；右键 → **切换自动启动**，即可在 VS Code 启动时自动开启。

### 端口转发示例

| 你想要… | 类型 | 输入 | 然后 |
|---|---|---|---|
| 访问只有服务器能连到的数据库 | `-L` | `5433:db.internal:5432` | `psql -h localhost -p 5433` |
| 让服务器访问你本机运行的开发服务 | `-R` | `9000:localhost:3000` | 在服务器上：`curl localhost:9000` |
| 浏览服务器所在的内网 | `-D` | `1080` | 把浏览器的 SOCKS5 代理设为 `127.0.0.1:1080` |

## 配置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `sshxStudio.databasePath` | `~/.sshx-studio/sshx.db` | 主机和端口转发的存储位置 |
| `sshxStudio.configPath` | `~/.ssh/config` | 导入用的 SSH config |
| `sshxStudio.terminalFontSize` | `13` | 终端字体大小 |

<details>
<summary>支持的 <code>ssh_config</code> 选项</summary>

`Host`、`Match all`、`Include`、`HostName`、`Port`、`User`、`IdentityFile`、`IdentitiesOnly`、`IdentityAgent`、`ProxyJump`、`ProxyCommand`、`LocalForward`、`RemoteForward`、`DynamicForward`、`ForwardAgent`、`ForwardX11`、`StrictHostKeyChecking`、`UserKnownHostsFile`、`ConnectTimeout`、`ServerAliveInterval`，以及 `%h %p %r %n %d %u` 变量。其他选项会随主机保存，但暂不生效。

</details>

## 安全与隐私

- **凭据** —— 密码、密钥密码短语和存储的私钥保存在 VS Code 的 SecretStorage 中，底层是 macOS 钥匙串、Windows 凭据管理器或 libsecret，不会写入数据库或磁盘文件。Linux 上需要运行 GNOME Keyring 或 KWallet 等密钥环服务，否则 VS Code 会退回到较弱的本地加密。
- **主机数据** —— 主机配置和端口转发保存在本地 SQLite 文件中（`~/.sshx-studio/sshx.db`，仅你本人可读），不会同步或上传。
- **主机密钥** —— 连接时按 `known_hosts` 校验服务器，密钥变化会拒绝连接。新密钥只有在你确认后（或按 `StrictHostKeyChecking` 的设置）才会添加。
- **转发** —— 开启 agent 转发后，服务器在连接期间可以使用你的密钥，请只对信任的服务器开启。X11 转发时，服务器只会拿到随机的伪造 cookie。
- **无遥测。** 除了你主动打开的 SSH 连接，扩展不会发起任何网络请求。

发现安全漏洞？请私下报告，详见 [SECURITY.md](SECURITY.md)。

## 常见问题

<details>
<summary>和 Remote - SSH 有什么区别？</summary>

Remote - SSH 会在远程机器上运行 VS Code 服务端，并把它作为你的工作区打开。SSHX Studio 不改变你的工作区，而是以标签页的形式为任意多台服务器提供终端、文件和隧道，服务器上除了 SSH 不需要任何东西。两者可以同时使用。
</details>

<details>
<summary>会修改我的 <code>~/.ssh/config</code> 吗？</summary>

不会，只在导入时读取。唯一可能写入的文件是 `known_hosts`，而且只在你确认了新的主机密钥之后。
</details>

<details>
<summary>X11 转发不起作用</summary>

本机需要 X 服务器：macOS 安装 [XQuartz](https://www.xquartz.org/)（安装后注销并重新登录），Windows 使用 VcXsrv 等，Linux 使用 X11 / XWayland 会话即可。服务器端需要允许 X11 转发（`sshd_config` 中 `X11Forwarding yes`）并安装 `xauth`。
</details>

<details>
<summary>能在 VSCodium、Cursor 等 VS Code 衍生版中使用吗？</summary>

可以，从 Open VSX 安装，或使用 Releases 页面上的 `.vsix`。
</details>

## 参与贡献

欢迎提交问题、建议和 Pull Request，构建、测试和提交方式请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。特别欢迎帮忙翻译。

## 许可证

[MIT](LICENSE) © fengqi
