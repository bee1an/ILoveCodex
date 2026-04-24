# CodexDock

[English](./README.md)

<p align="center">
  <img src="./docs/codexdock-logo.png" alt="CodexDock logo" width="128" height="128">
</p>

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

```bash
cdock account list                         # 列出所有受管账号
cdock account import-current               # 导入当前本机 Codex 登录态
cdock account import [--file <path>]        # 从 JSON 文件或 stdin 导入账号
cdock account export [account-id...]        # 导出全部账号或指定账号
cdock account activate <account-id>         # 将指定账号切换为当前 Codex 会话
cdock account best                         # 自动切换到当前最优账号
cdock account remove <account-id>           # 删除一个受管账号
cdock instance list                        # 列出隔离 Codex 实例
cdock instance create --name <name>         # 创建新的隔离 Codex 实例
cdock instance update <instance-id|default> # 更新实例配置
cdock instance start <instance-id|default>  # 启动隔离实例
cdock instance stop <instance-id|default>   # 停止运行中的隔离实例
cdock instance remove <instance-id>         # 删除隔离实例
cdock provider list                        # 列出自定义 API Provider
cdock provider create                      # 交互式或通过参数创建 Provider
cdock provider update <provider-id>         # 更新 Provider 配置
cdock provider remove <provider-id>         # 删除 Provider
cdock provider check <provider-id>          # 检查 Provider 是否可用
cdock provider open <provider-id>           # 使用 Provider 打开 Codex
cdock tag list                             # 列出账号标签
cdock tag create <name>                     # 创建标签
cdock tag rename <tag-id> <name>            # 重命名标签
cdock tag remove <tag-id>                   # 删除标签
cdock tag assign <account-id> <tag-id>      # 给账号分配标签
cdock tag unassign <account-id> <tag-id>    # 从账号移除标签
cdock session current                      # 查看当前活跃 Codex 会话
cdock usage read [account-id]               # 查看会话额度和周额度
cdock cost read [--refresh]                 # 查看 token 消耗统计
cdock login browser                        # 发起浏览器登录
cdock login device                         # 发起设备码登录
cdock login port status                     # 查看本地登录回调端口状态
cdock login port kill                       # 结束占用登录回调端口的进程
cdock codex show                           # 查看检测到的 Codex 桌面配置
cdock codex open [account-id]               # 使用指定账号启动 Codex
cdock codex open-isolated <account-id>      # 在隔离环境中启动 Codex
cdock doctor                               # 执行环境诊断
cdock settings get [key]                    # 读取单个或全部设置
cdock settings set <key> <value>            # 更新设置
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
