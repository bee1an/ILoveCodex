# CodexDock

[English](./README.md)

CodexDock 是一个用于管理 Codex 会话账号的桌面应用。它提供了一个适合常驻使用的 Electron 图形界面，用来切换账号、查看额度、启动 Codex，也提供了 `cdock` CLI 以便脚本化操作相同流程。

![CodexDock 截图](./docs/screenshot.png)

## 功能概览

- 将当前本机的 Codex 登录态导入为受管账号
- 发起浏览器登录或设备码登录流程
- 切换到指定账号，或自动切换到最优账号
- 读取已保存账号的会话额度和周额度
- 使用选中的账号启动 Codex 桌面应用
- 管理轮询间隔、语言、主题和状态栏显示账号等设置
- 通过 `cdock` CLI 提供同样的核心能力

## 图形界面与命令行

这个项目有两个主要入口：

- Desktop app：基于 Electron + Svelte 的图形界面，适合日常账号管理
- CLI：`cdock`，适合自动化、查看状态和账号操作

支持的命令：

```text
cdock account list
cdock account import-current
cdock account import [--file <path>]
cdock account export [account-id...]
cdock account activate <account-id>
cdock account best
cdock account remove <account-id>
cdock instance list
cdock instance create --name <name>
cdock instance update <instance-id|default>
cdock instance start <instance-id|default>
cdock instance stop <instance-id|default>
cdock instance remove <instance-id>
cdock provider list
cdock provider create
cdock provider update <provider-id>
cdock provider remove <provider-id>
cdock provider check <provider-id>
cdock provider open <provider-id>
cdock tag list
cdock tag create <name>
cdock tag rename <tag-id> <name>
cdock tag remove <tag-id>
cdock tag assign <account-id> <tag-id>
cdock tag unassign <account-id> <tag-id>
cdock session current
cdock usage read [account-id]
cdock login browser
cdock login device
cdock login port status
cdock login port kill
cdock codex show
cdock codex open [account-id]
cdock codex open-isolated <account-id>
cdock doctor
cdock settings get [key]
cdock settings set <key> <value>
```

全局 CLI 参数：

- `--json`
- `--quiet`
- `--no-open`
- `--timeout <sec>`
- `--help`

打包后的应用也会在 `resources/bin/` 下附带 `cdock` wrapper。安装后的应用启动一次后，会尝试把用户级 `cdock` shim 安装到一个可写的 `PATH` 目录中，这样之后就可以在终端里直接执行 `cdock ...`。

## Homebrew Tap（macOS）

macOS 版本可以通过自有 Homebrew tap 分发：

```bash
brew tap bee1an/codexdock
brew install --cask codexdock
```

后续升级：

```bash
brew update
brew upgrade --cask codexdock
```

### 如果第一次打开时被 macOS 拦截

当前构建还没有经过 Apple 公证，所以第一次打开时，macOS Gatekeeper 可能会弹出“Apple 无法验证 `CodexDock.app` 是否包含恶意软件”之类的提示。

推荐处理方式：

1. 在弹窗里先点“完成”，不要点“移到废纸篓”。
2. 打开“系统设置 -> 隐私与安全性”。
3. 滚动到“安全性”区域，点“仍要打开”或“打开”。

如果你更习惯命令行，并且只想放行这个 App，可以执行：

```bash
xattr -dr com.apple.quarantine "/Applications/CodexDock.app"
open "/Applications/CodexDock.app"
```

如果想先确认是否带有隔离标记，可以先执行：

```bash
xattr -l "/Applications/CodexDock.app"
```

不建议为了这个问题全局关闭 Gatekeeper。

现在 release workflow 已经预留了“发版后自动更新 tap 仓库”的流程。具体配置方法见 [docs/homebrew-tap.md](./docs/homebrew-tap.md)。

## 接口文档

- [Postman Collection](./docs/postman-collection.json)
