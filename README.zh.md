[English](README.md) | 中文

# dsh-plugin-relay

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，下称 dsh）接入任意 **new-api 系中转站面板**（one-api / new-api / Veloera / done-hub 等）的 dsh 插件。全部功能都在 dsh web 设置页——没有 CLI，不需要手工编辑配置文件，也不预置任何面板专属默认值。v0.6.0 起**支持同时接入多套面板**——每套是 dsh 里的一个独立模型提供方，在模型选择器中并列可选。

![API Keys](assets/screenshot-keys.zh.png)

## 功能

- **面板（连接）** — 「连接」选项卡列出全部已接入面板（账户、余额、已同步模型数、当前 key 一目了然），并可新增：名称（创建后不可修改——它同时是 dsh 模型提供方的名字）、API 地址、访问令牌（只写不回显）、用户 ID。每个面板配「测试连接」按钮，失败分类可读：无法连接 / 令牌无效 / 用户 ID 不配对。点击行进入该面板的详情页。
- **API Keys**（按面板）— 新建、编辑（名称 / 分组 / 额度 / 有效期 / 启停）、删除，以及一键「使用」切换。编辑采用**行内原地展开**（对齐官方「模型」页的行↔卡交互）：一次只展开一张编辑卡，「应用」即刻写入、失败卡不收起，删除经确认对话框执行。key 明文绝不经过浏览器——创建响应由服务端剥离，「创建并设为生效」走常规切换流程，明文只进服务端凭据文件。
- **模型**（按面板）— 当前生效 key 可调用的模型与价格，覆盖面板家族的全部三种计价口径：按量美元价（$/1M tokens）、按次固定价、经典倍率价（模型倍率 × 分组倍率）。刷新列表时自动同步给 dsh，运行中的会话立即生效。
- **数据看板**（按面板）— 余额、今日消耗、累计数据，以及手写 SVG 按模型消耗堆叠图：金额 / Token 两种口径、7 / 14 / 30 天范围切换、图例点击显隐；四张汇总卡固定一行。面板仅保留近期用量桶，稀疏数据有可读空态。
- **使用日志**（按面板）— 面板请求日志：页头用量 / RPM / TPM 统计，时间 / 模型 / 密钥 / 分组筛选（点「查询」生效），用量列含缓存与推理 token 小字及首字耗时。
- **模型能力** — 由**预置知识库**（编译期从 [models.dev](https://models.dev) **主流模型**生成——仅收录第一方作者厂商、近 1 年内发布、对话类模型；可一键联网刷新——按钮就在预置折叠面板内）、你的自定义条目与按面板按 id 的覆盖配置三层组成。三个分区都采用**原地展开编辑**（对齐官方「模型」页行↔卡交互）——一次展开一张卡，「完成」即保存，没有全局保存按钮；上下文窗口与**输出上限**支持 `128K` / `1M` 简写（1024 进制）并实时显示换算。匹配按层级进行：覆盖 → 知识库（精确 → 大小写折叠 → 剥变体后缀 → 版本分隔符互换 → 唯一变体补全 → 人工别名），近似命中标注「近似」，匹配到的知识库名显示在模型 id 下方。平台模型分区按面板分组，每组带覆盖率指示。
- **多面板** — 每套面板是独立的 pi-ai 提供方（`<面板>/v1` 上的 `openai-completions`，各自独立的凭据引用），dsh 会话同时看到所有面板的模型（按提供方分组命名）。删除面板会一并清理它的路由、能力覆盖与凭据引用；全局知识库不受影响。
- **热生效** — 凭据、模型目录、能力配置全部经 dsh settings/credentials 服务写入；运行中的会话在下一次请求时立即应用，无需重启。插件**不再管理默认模型**——模型请在 dsh 侧自行选择。

## 界面截图

| 连接（面板列表） | API Keys | 模型 |
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

1. 打开 **设置 → 中转站 → 连接**，点「新增中转站」：填写名称（字母 / 数字 / `_` / `-`，≤32 字符——它同时是模型提供方的名字）、面板首页地址（不带 `/v1` 后缀）、面板「个人中心」的访问令牌与用户 ID。*测试连接* 可在配置 key 前先验证三项配置。
2. 点击面板行进入详情页。在「API Keys」页新建 key（或对既有 key 点「使用」）：插件把 key 写入 dsh 凭据存储、建立该面板的模型路由并同步模型目录。需要几套就接几套——它们同时生效。
3. 在「模型」页查看每个模型的价格；刷新列表会让 dsh 的路由目录始终与 key 的实际可调用集合一致。
4. 「数据看板」「使用日志」随时查看余额与消耗；两者只读面板的报表接口。
5. 「模型能力」页（主页）：预置条目默认折叠、可按名搜索，需要微调时一键复制进「我的条目」；「刷新预置」单按钮联网取最新值，并自动重新应用到每个面板的模型目录。上下文窗口与输出上限 `131072`、`128K`、`1M` 写法等价。仅当个别面板模型 id 需要不同取值时才编辑对应卡片——「完成」即刻保存为该面板的覆盖配置。

## 工作原理

- 插件注册 `relay` 设置 namespace：`panels` 字典（每套面板的连接字段；访问令牌是 secret 字段，接口层自动脱敏）、全局知识库与按面板分组的覆盖配置；并在 dsh 的浏览器信任围栏内提供 `/api/relay/{state,panels,panels-create,panels-update,panels-delete,connection-test,keys,keys-create,keys-update,keys-delete,use,models,capabilities,model-info,knowledge-refresh,dashboard,logs,logs-stat,logs-meta}` 路由。
- 每套面板首次切换 key 时，插件把该面板的 pi-ai 路由配置（`api: openai-completions`、`baseURL: <面板>/v1`、`apiKeyEnv: RELAY_API_KEY_<面板名大写>`、合并后的模型目录）写入 dsh 设置——dsh 对路由热加载，无需重启。API key 本身按请求从该面板的凭据引用解析。
- 目录同步按模型 id 合并：存活模型的手工修正全部保留；key 已不可调用的模型会被移除，dsh 只会提供 key 真正能调用的模型。路由条目上的能力字段是**派生状态**：每次同步、每次能力保存、每次预置刷新都按「覆盖 → 知识库（自定义优先，其次预置层）」重放；只有插件持有配置的字段才会被写——你在官方「模型」页对未配置 id 的手工修改不会被冲掉。
- 能力保存是**定向操作**（`catalogSet` / `catalogDelete` / `overrideSet` / `overrideDelete`，覆盖操作携带所属面板），逐条落到 settings 路径操作——删除真实生效，不会被深合并掩盖——随后对受影响的路由目录做修订守卫重放。
- 预置知识库由 `npm run preset:fetch` 在构建期生成（models.dev 第一方白名单、365 天发布窗口、剔除非对话模型、渠道重复登记去重；可选 OpenRouter 用量兜底——设置 `OPENROUTER_API_KEY`）并提交进源码；「刷新预置」按钮在宿主内存里用实时 models.dev 重建——并重放到全部已配置路由——重启后有意回落到编译基线。

## 安全说明

- 每套面板的访问令牌存于 secret 设置字段（所有接口面自动脱敏，包括嵌套在 panels 字典内）；API key 只写入服务端凭据存储（`.credentials.yaml`，0600），从不回传浏览器——创建 key 的响应由服务端剥离明文，也不提供「复制 key」类功能。
- 插件全部路由位于 dsh 浏览器信任围栏内（同源 + 签名会话），未认证请求返回 401。
- models.dev 查询在宿主侧进行（带缓存与单飞合并），浏览器不直连第三方；预置生成脚本不触碰任何中转站面板与凭据。

## 兼容性

- 要求 dsh ≥ **0.1.5-rc.2**（`engines.dsh` 强制）——这是首个在冻结浏览器模块表中携带 `@deepseek-ai/dsh-client-ui-primitives` 的宿主；本插件 UI 运行时消费该包（宿主供给自己编译的版本，插件不以它为运行时依赖——仅作为**精确锁版到宿主对应版本**的 devDependency 提供类型；npm 的 `latest` 标签虽停在早期 rc，但同版本构建一直在随 dsh 锁步发布）。
- 浏览器验收覆盖 dsh **0.1.5-rc.2** 与 **0.1.5-rc.3**（当前 npm 线）。本插件消费的 primitives 子集（Button / Switch / Pill / Tag / StateDot / Menu / Modal）经 diff 实证到 **0.1.7-rc.1** git tag 仍向后兼容。
- 插件有意只消费该稳定子集，并在每次升级 dsh 开发依赖后重跑一轮浏览器走查（见 docs/PUBLISHING.md）。

## 已知限制

- 管理 API 需要配对的用户 ID（每套面板手动填写一次；见面板「个人中心」）。
- 面板与知识库都未报告模型容量时，按 id 前缀启发式推断 context window / 最大输出，未识别的 id 回退 131072 / 8192。
- 知识库匹配每一层都要求全等（大小写折叠、剥后缀、版本分隔符互换、变体补全），歧义即放弃；渠道命名的面板特有模型（如 `grok-video`）按设计不匹配。
- 预置基线只收录主流模型——第一方厂商近 1 年内发布的对话模型。售卖更老或小众模型的面板会回落「未配置」；可自建条目或等「刷新预置」（同一套规则）。
- 预置刷新只保存在宿主内存——这是设计而非缺陷，重启回落到编译基线；持久化新基线是 `npm run preset:fetch` 的职责。
- 面板名称创建后不可修改（它是路由键、凭据引用与覆盖分组的名字）；改名 = 删除重建。
- 面板对日志明细与看板桶只保留近期数据；更早的数据属于面板保留策略，不是插件缺陷。
- models.dev 是第三方快照——未收录的模型与 toggle 型推理以手动配置兜底。
- token 数量简写按 1024 进制（`128K` = 131072）；个别厂商宣传十进制容量（如 200K = 200000），保存前请看实时换算提示。

## 开发

```sh
npm install        # @deepseek-ai/dsh 为 devDependency；运行时零 dependencies（schemastery 为 peer）
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js（宿主 ESM）+ lib/client.js（浏览器包裹产物）
npm test           # vitest：单测 + mock 中转站面板，不触碰真实 dsh home
npm start          # 开发启动：dsh web --port 3098，使用本仓库 .dsh-home
npm start -- --no-open   # 同上，但不自动打开系统浏览器
npm run preset:fetch    # 重新生成 src/knowledge-preset.generated.ts（models.dev 主流基线；OpenRouter 兜底可选）
```

版本历史见 [CHANGELOG.md](CHANGELOG.md)；开发笔记（工作日志、任务书、发布清单）见 [docs/](docs)；dsh 集成语义见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)
