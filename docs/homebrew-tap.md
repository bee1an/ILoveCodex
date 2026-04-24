# Homebrew Tap 发布

这个仓库现在已经预留了“发布后自动更新自有 Homebrew tap”的流程，适合 macOS 用户通过下面的方式安装：

```bash
brew tap bee1an/codexdock
brew install --cask codexdock
```

之后升级：

```bash
brew update
brew upgrade --cask codexdock
```

## 需要准备什么

1. 创建一个 tap 仓库，例如：
   - `bee1an/homebrew-codexdock`
2. 在 tap 仓库里保留默认分支（推荐 `main`）
3. 在当前仓库配置一个 secret：
   - `HOMEBREW_TAP_TOKEN`
   - 这个 token 需要对 tap 仓库有 `contents: write`
4. 可选地配置一个仓库变量：
   - `HOMEBREW_TAP_REPOSITORY`
   - 默认值是 `bee1an/homebrew-codexdock`

## 自动化会做什么

当前 `/Users/bee/j/codexdock/.github/workflows/release.yml` 在 tag 发布完成后会：

1. 从 GitHub Release 下载本次的 macOS `.dmg`
2. 计算 `sha256`
3. 生成 `Casks/codexdock.rb`
4. 提交并推送到你的 Homebrew tap 仓库

如果没有配置 `HOMEBREW_TAP_TOKEN`，这个步骤会自动跳过，不会影响正常发版。

## 生成的 Cask

当前生成的 cask 默认参数：

- token：`codexdock`
- app：`CodexDock.app`
- 架构限制：`arm64`

之所以默认限制为 `arm64`，是因为当前 release 流程生成的 macOS 构建产物就是 ARM 版本。如果后面改成 universal 或额外增加 Intel 产物，再调整生成脚本即可。
