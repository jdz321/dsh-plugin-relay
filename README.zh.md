[English](README.md) | 中文

# dsh-plugin-relay

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，下称 dsh）接入任意 **new-api 系中转站面板**（one-api / new-api / Veloera / done-hub 等）的 dsh 插件。全部功能都在 dsh web 设置页——没有 CLI，不需要手工编辑配置文件，也不预置任何面板专属默认值。

![API Keys](assets/screenshot-keys.zh.png)

## 功能

- **连接** — API 地址、访问令牌（只写不回显）、用户 ID 在「连接」选项卡维护，保存即热生效；连接字段由插件运行时镜像到 dsh 路由配置。
- **API Keys** — 「API Keys」选项卡列出账户全部 key（名称、分组、分组倍率、额度、有效期，**不含 key 内容**）；一键「使用」切换生效 key，切换时自动同步该 key 的模型目录与默认模型；切到已禁用的 key 会附加警告。
- **模型** — 「模型」选项卡展示当前生效 key 可调用的模型与价格，覆盖面板家族的全部三种计价口径：按量美元价（$/1M tokens）、按次固定价、经典倍率价（模型倍率 × 分组倍率）。刷新列表时自动同步给 dsh，运行中的会话立即生效。
- **模型能力** — 「模型能力」选项卡按模型配置输入模态（文本 / 图片）与推理行为（显式非推理，或推理档位）。写入的是与官方「模型」设置页同一份按模型字段，字段级合并、互不覆盖；支持一键从 [models.dev](https://models.dev) 获取参考值，也可手工添加 / 删除模型。
- **热生效** — 凭据、模型目录、默认模型、能力配置全部经 dsh settings/credentials 服务写入；运行中的会话在下一次请求时立即应用，无需重启。

## 界面截图

| 连接 | API Keys |
| --- | --- |
| ![连接](assets/screenshot-connection.zh.png) | ![API Keys](assets/screenshot-keys.zh.png) |
| **模型** | **模型能力** |
| ![模型](assets/screenshot-models.zh.png) | ![模型能力](assets/screenshot-capabilities.zh.png) |

## 安装

要求 Node ≥ 20，pnpm 在 PATH 上（dsh 的插件安装走 pnpm）。

```sh
# 从 npm 安装（发布后）
dsh plugin --profile web add dsh-plugin-relay

# 或从本地 clone 安装
npm install && npm run build
dsh plugin --profile web add /path/to/dsh-plugin-relay
```

如需在 headless 会话使用，按同样方式装进 headless profile（`--profile headless`）。然后重启 `dsh web`，打开 **设置 → 中转站**。

## 使用

1. 打开 **设置 → 中转站 → 连接**，填写面板首页地址（不带 `/v1` 后缀）、面板「个人中心」的访问令牌，以及同一页面显示的用户 ID，保存。
2. 在「API Keys」页选择一个 key 点「使用」。插件会把 key 写入 dsh 凭据存储、建立模型路由（`<面板>/v1` 上的 `openai-completions`）、同步该 key 的模型目录并设置默认模型。
3. 在「模型」页查看每个模型的价格；刷新列表会让 dsh 的路由目录始终与 key 的实际可调用集合一致。
4. 需要时在「模型能力」页微调各模型的输入模态与推理档位——可选；未配置的模型跟随路由默认。

## 工作原理

- 插件注册 `relay` 设置 namespace（令牌为 secret 字段），并在 dsh 的浏览器信任围栏内提供 `/api/relay/{state,keys,use,models,capabilities,model-info}` 路由。
- 首次切换 key 时，插件把 pi-ai 路由配置（`api: openai-completions`、`baseURL: <面板>/v1`、`apiKeyEnv: RELAY_API_KEY`、合并后的模型目录）写入 dsh 设置——dsh 对路由热加载，无需重启。API key 本身按请求从凭据引用（默认 `RELAY_API_KEY`）解析。
- 目录同步按模型 id 合并：存活模型的能力配置与手工修正全部保留；key 已不可调用的模型会被移除，dsh 只会提供 key 真正能调用的模型。
- 能力保存走 settings 修订守卫 + 有界重试，只触碰能力字段——任何并发写入者的字段都不会被冲掉。

## 安全说明

- 中转站访问令牌存于 secret 设置字段（接口层自动脱敏）；API key 只写入服务端凭据存储（`.credentials.yaml`，0600），从不回传浏览器。
- 插件全部路由位于 dsh 浏览器信任围栏内（同源 + 签名会话），未认证请求返回 401。
- models.dev 查询经宿主路由代理（带缓存与单飞合并），浏览器不直连第三方。

## 已知限制

- 管理 API 需要配对的用户 ID（手动填写一次；见面板「个人中心」）。
- 面板未报告模型容量时，按 id 前缀启发式推断 context window / 最大输出，未识别的 id 回退 131072 / 8192；手工修正不会被覆盖。
- 价格与额度按面板口径展示；¥ 数值是面板侧估算。
- models.dev 是第三方快照——未收录的模型与 toggle 型推理以手动配置兜底。

## 开发

```sh
npm install        # @deepseek-ai/dsh 为 devDependency；运行时零 dependencies（schemastery 为 peer）
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js（宿主 ESM）+ lib/client.js（浏览器包裹产物）
npm test           # vitest：单测 + mock 中转站面板，不触碰真实 dsh home
npm start          # 开发启动：dsh web --port 3098，使用本仓库 .dsh-home
```

版本历史见 [CHANGELOG.md](CHANGELOG.md)；开发笔记（工作日志、v0.4.0 任务书、发布清单）见 [docs/](docs)；dsh 集成语义见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)
