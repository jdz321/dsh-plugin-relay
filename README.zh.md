[English](README.md) | 中文

# dsh-plugin-relay

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，下称 dsh）接入任意 **new-api 系中转站面板**（one-api / new-api / Veloera / done-hub 等）的 dsh 插件。全部功能都在 dsh web 设置页——没有 CLI，不需要手工编辑配置文件，也不预置任何面板专属默认值。

![API Keys](assets/screenshot-keys.zh.png)

## 功能

- **连接** — API 地址、访问令牌（只写不回显）、用户 ID 在「连接」选项卡维护，保存即热生效；连接字段由插件运行时镜像到 dsh 路由配置。
- **API Keys** — 「API Keys」选项卡管理账户全部 key：新建、编辑（名称 / 分组 / 额度 / 有效期 / 启停）、删除，以及一键「使用」切换。key 明文绝不经过浏览器——创建响应由服务端剥离，「创建并设为生效」走常规切换流程，明文只进服务端凭据文件。删除当前生效 key 会附加警示；切到已禁用的 key 同样如此。
- **模型** — 「模型」选项卡展示当前生效 key 可调用的模型与价格，覆盖面板家族的全部三种计价口径：按量美元价（$/1M tokens）、按次固定价、经典倍率价（模型倍率 × 分组倍率）。刷新列表时自动同步给 dsh，运行中的会话立即生效。
- **数据看板** — 「数据看板」选项卡展示余额、今日消耗、累计数据，以及近 7 天按模型的消耗堆叠图（金额 / Token 两种口径切换）。面板仅保留近期用量桶，稀疏数据有可读空态。
- **使用日志** — 「使用日志」选项卡列出面板请求日志：页头用量 / RPM / TPM 统计，时间 / 模型 / 密钥 / 分组筛选（点「查询」生效），用量列含缓存与推理 token 小字及首字耗时。
- **模型能力** — 「模型能力」选项卡维护一个**不随 key 切换变化**的能力知识库：按规范模型名（与 models.dev 命名一致）配置输入模态、推理与默认上下文窗口；按面板模型 id 的覆盖配置优先于知识库；同步模型目录时按匹配规则（精确 id → 剥变体后缀 → 不触碰）落到路由条目。支持一键从 [models.dev](https://models.dev) 获取默认值。
- **热生效** — 凭据、模型目录、能力配置全部经 dsh settings/credentials 服务写入；运行中的会话在下一次请求时立即应用，无需重启。插件**不再管理默认模型**——模型请在 dsh 侧自行选择。

## 界面截图

| 连接 | API Keys | 模型 |
| --- | --- | --- |
| ![连接](assets/screenshot-connection.zh.png) | ![API Keys](assets/screenshot-keys.zh.png) | ![模型](assets/screenshot-models.zh.png) |
| **数据看板** | **使用日志** | **模型能力** |
| ![数据看板](assets/screenshot-dashboard.zh.png) | ![使用日志](assets/screenshot-logs.zh.png) | ![模型能力](assets/screenshot-capabilities.zh.png) |

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
2. 在「API Keys」页新建一个 key（或对既有 key 点「使用」）。插件会把 key 写入 dsh 凭据存储、建立模型路由（`<面板>/v1` 上的 `openai-completions`）并同步该 key 的模型目录。模型由 dsh 自己的模型选择器按会话决定，插件不干预。
3. 在「模型」页查看每个模型的价格；刷新列表会让 dsh 的路由目录始终与 key 的实际可调用集合一致。
4. 「数据看板」「使用日志」随时查看余额与消耗；两者只读面板的报表接口。
5. 「模型能力」页把知识库配置一次（↻ 从 models.dev 获取默认值，含上下文窗口）；仅当个别面板模型 id 需要不同取值时才编辑对应卡片。

## 工作原理

- 插件注册 `relay` 设置 namespace（令牌为 secret 字段；能力知识库与覆盖配置也存于此），并在 dsh 的浏览器信任围栏内提供 `/api/relay/{state,keys,keys-create,keys-update,keys-delete,use,models,capabilities,model-info,dashboard,logs,logs-stat,logs-meta}` 路由。
- 首次切换 key 时，插件把 pi-ai 路由配置（`api: openai-completions`、`baseURL: <面板>/v1`、`apiKeyEnv: RELAY_API_KEY`、合并后的模型目录）写入 dsh 设置——dsh 对路由热加载，无需重启。API key 本身按请求从凭据引用（默认 `RELAY_API_KEY`）解析。
- 目录同步按模型 id 合并：存活模型的手工修正全部保留；key 已不可调用的模型会被移除，dsh 只会提供 key 真正能调用的模型。路由条目上的能力字段是**派生状态**：每次同步都按知识库与覆盖规则重放；只有插件持有配置的字段才会被写——你在官方「模型」页对未配置 id 的手工修改不会被冲掉。
- 能力保存与目录同步都走 settings 修订守卫 + 有界重试，任何并发写入者的字段都不会被冲掉。

## 安全说明

- 中转站访问令牌存于 secret 设置字段（接口层自动脱敏）；API key 只写入服务端凭据存储（`.credentials.yaml`，0600），从不回传浏览器——创建 key 的响应由服务端剥离明文，也不提供「复制 key」类功能。
- 插件全部路由位于 dsh 浏览器信任围栏内（同源 + 签名会话），未认证请求返回 401。
- models.dev 查询经宿主路由代理（带缓存与单飞合并），浏览器不直连第三方。

## 已知限制

- 管理 API 需要配对的用户 ID（手动填写一次；见面板「个人中心」）。
- 面板与知识库都未报告模型容量时，按 id 前缀启发式推断 context window / 最大输出，未识别的 id 回退 131072 / 8192。
- 知识库匹配最多剥两层尾部 `-变体` 后缀；渠道命名的面板特有模型（如 `grok-video`）按设计不匹配。
- 面板对日志明细与看板桶只保留近期数据；更早的数据属于面板保留策略，不是插件缺陷。
- models.dev 是第三方快照——未收录的模型与 toggle 型推理以手动配置兜底。

## 开发

```sh
npm install        # @deepseek-ai/dsh 为 devDependency；运行时零 dependencies（schemastery 为 peer）
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js（宿主 ESM）+ lib/client.js（浏览器包裹产物）
npm test           # vitest：单测 + mock 中转站面板，不触碰真实 dsh home
npm start          # 开发启动：dsh web --port 3098，使用本仓库 .dsh-home
npm start -- --no-open   # 同上，但不自动打开系统浏览器
```

版本历史见 [CHANGELOG.md](CHANGELOG.md)；开发笔记（工作日志、任务书、发布清单）见 [docs/](docs)；dsh 集成语义见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)
