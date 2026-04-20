# Ilovecodex

[English](./README.md)

Ilovecodex 是一个用于管理 Codex 会话账号的桌面应用。它提供了一个适合常驻使用的 Electron 图形界面，用来切换账号、查看额度、启动 Codex，也提供了 `ilc` CLI 以便脚本化操作相同流程。

![Ilovecodex 截图](./docs/screenshot.png)

## 功能概览

- 将当前本机的 Codex 登录态导入为受管账号
- 发起浏览器登录或设备码登录流程
- 切换到指定账号，或自动切换到最优账号
- 读取已保存账号的会话额度和周额度
- 使用选中的账号启动 Codex 桌面应用
- 管理轮询间隔、语言、主题和状态栏显示账号等设置
- 通过 `ilc` CLI 提供同样的核心能力

## 图形界面与命令行

这个项目有两个主要入口：

- Desktop app：基于 Electron + Svelte 的图形界面，适合日常账号管理
- CLI：`ilc`，适合自动化、查看状态和账号操作

支持的命令：

```text
ilc account list
ilc account import-current
ilc account import [--file <path>]
ilc account export [account-id...]
ilc account activate <account-id>
ilc account best
ilc account remove <account-id>
ilc instance list
ilc instance create --name <name>
ilc instance update <instance-id|default>
ilc instance start <instance-id|default>
ilc instance stop <instance-id|default>
ilc instance remove <instance-id>
ilc provider list
ilc provider create
ilc provider update <provider-id>
ilc provider remove <provider-id>
ilc provider check <provider-id>
ilc provider open <provider-id>
ilc tag list
ilc tag create <name>
ilc tag rename <tag-id> <name>
ilc tag remove <tag-id>
ilc tag assign <account-id> <tag-id>
ilc tag unassign <account-id> <tag-id>
ilc session current
ilc usage read [account-id]
ilc login browser
ilc login device
ilc login port status
ilc login port kill
ilc codex show
ilc codex open [account-id]
ilc codex open-isolated <account-id>
ilc doctor
ilc settings get [key]
ilc settings set <key> <value>
```

全局 CLI 参数：

- `--json`
- `--quiet`
- `--no-open`
- `--timeout <sec>`
- `--help`

打包后的应用也会在 `resources/bin/` 下附带 `ilc` wrapper。安装后的应用启动一次后，会尝试把用户级 `ilc` shim 安装到一个可写的 `PATH` 目录中，这样之后就可以在终端里直接执行 `ilc ...`。

## 接口文档

- [Postman Collection](./docs/postman-collection.json)
