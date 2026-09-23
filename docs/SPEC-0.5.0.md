# dsh-plugin-relay → v0.5.0 开发任务书（Spec）

> **状态：未实施。** 调研已完成（2026-09-24），§2 的接口形状与模型 id 匹配事实均为**实证面板只读探测**结果，可直接引用，不必重新考古。实施前必读：仓库根 `AGENTS.md`（红线与 dsh 集成语义）、`docs/local.md`（本机真实账号与环境，gitignored）。
> **执行者**：接手本任务的 AI 编码会话（可无人值守自主完成开发、测试、验收、文档）。

---

## 0. 执行守则

**硬性约束**（违反即失败）：

1. AGENTS.md §0 红线全部有效：不碰操作者自己的 dsh home 与实例；只按 PID 杀自己起的进程；手工起 dsh 内联 `DSH_HOME=<隔离目录>`；仓库内 `.dsh-home/` 是真实配置；密钥/测试信息不入 git；隔离测试 home 从零 `dsh plugin add` 创建；临时产物进 `.tmp/` 收尾删除（清理前的真实 home 备份除外，见 `docs/local.md`）。
2. **真实账号使用边界**：只读调用（列表、日志、看板、模型 id）可随意；**面板账号的写操作（key 创建/修改/删除）仅在两种场景允许**——① 隔离验证用一次性临时 key（名称前缀 `dsh-temp-`，用后即删，面板不残留）；② 操作者在会话中明确要求的操作。任何写操作不得触碰既有 key。
3. **程序化编辑 home 内文件后必须核对权限**：`.credentials.yaml` 与 `settings.yaml` 保持 0600（AGENTS.md §4.2 的教训：rename 会落 umask 权限，credentials-local 拒绝加载）。
4. 不修改本工作区之外的任何文件；commit 仅在操作者明确要求时进行。
5. settings/credentials 写入在请求处理器里必须 `await` 落定再返回响应（AGENTS.md §4.1）。

**工作方式**：

6. **结果导向**：只对 §9 验收要求与 §11 DoD 负责。【要求】是验收契约；【建议】是基线，可自主偏离并在报告说明理由。
7. **正确性 > 便捷性**；类型真实表达领域；不确定的事实联网查证或读 `node_modules` 源码，禁止编造；外网直连失败时按 `docs/local.md` 配置代理。

---

## 1. 背景与目标

v0.4.0 已交付连接 / API Keys / 模型 / 模型能力 四选项卡。v0.5.0 按操作者反馈做七项需求：

| # | 需求 | 结果描述 |
|---|------|----------|
| R1 | 模型能力改造 | 「模型能力」维护一个**不随 key 切换变化**的模型能力知识库（输入模态、推理强度、**默认上下文窗口**），默认值可从 models.dev 联网获取；同步模型目录给 dsh 时按**匹配规则**把知识库配置落到路由模型条目上 |
| R2 | 移除默认模型管理 | 插件不再设置「默认模型」，用户在 dsh 侧自行选择；删除相关写入、展示与文案 |
| R3 | 账户行精简 | API Keys 页签账户行去掉多余的「分组 / 倍率」展示 |
| R4 | API key 增删改 | API Keys 页签支持新建 key、编辑已有 key（名称 / 分组 / 额度 / 有效期 / 启用状态）、删除 key |
| R5 | 数据看板 | 新页签（排序在「模型能力」之前）：余额 / 消耗卡片 + 近 7 天按模型的消耗堆叠图（金额 / Token 两种口径切换） |
| R6 | 使用日志 | 新页签（排序在「数据看板」之后）：面板请求日志列表，带时间 / 模型 / 密钥 / 分组筛选与分页 |
| R8 | 启动不自动开浏览器 | `npm start` 支持 `--no-open`：透传给 dsh web，启动不自动拉起系统默认浏览器 |
| R7 | UI 参照 | 看板与日志的信息架构参照面板控制台参考图（`docs/local-assets/`，gitignored），形态适配设置对话框宽度 |

版本号 `0.5.0`。页签最终顺序：**连接 / API Keys / 模型 / 数据看板 / 使用日志 / 模型能力**。

---

## 2. 已核实的关键事实（实证面板只读探测 + 上游源码，2026-09-24）

### 2.1 token 管理（key 增删改）

- 列表 `GET /api/token/?p=1&size=N` → `{data: {page, page_size, total, items: [...]}}`。条目字段：`id, user_id, key(明文，插件侧必须剥离), status(1 启用/2 禁用…), name, created_time, accessed_time, expired_time(-1=永久), remain_quota, unlimited_quota, model_limits_enabled, model_limits(逗号分隔 id 串), allow_ips, used_quota, group` + fork 扩展（`scope, plan_id, disabled_by, plan_exhausted_policy` 等，透传忽略）。
- 创建 `POST /api/token/`：body 为 token 对象。**该 fork 校验「分组不能为空」**（空体实测返回此错误）。上游字段：`name, group, expired_time, remain_quota, unlimited_quota, model_limits_enabled, model_limits, allow_ips, auto_groups`（fork 扩展可选）。key 由服务端生成，创建响应的 `data.key` 是**唯一一次能看到明文的机会**。
- 更新 `PUT /api/token/`：body 必须带 `id`（实测空体返回「id 或 userId 为空！」）；语义为整对象更新，须以列表读到的现值为基础改字段后回传。
- 删除 `DELETE /api/token/{id}`（实测对不存在 id 返回 `record not found`，路由存在）。
- 响应统一 `{success, message, data?}`；管理鉴权仍是 `Authorization: Bearer <accessToken>` + `New-Api-User: <userId>` 成对。

### 2.2 使用日志

- `GET /api/log/self?p=<页码>&page_size=<每页>&type=0&start_timestamp=<秒>&end_timestamp=<秒>&token_name=&model_name=&group=` → `{data: {page, page_size, total, items: [...]}}`。
- 条目关键字段：`created_at(秒), type(2=消耗), token_name, group, model_name, quota(本次费用点数), prompt_tokens, completion_tokens, use_time(总耗时秒), is_stream, reasoning_tokens, reasoning_effort, cache_read_tokens, cache_creation_tokens, cache_creation_5m_tokens, cache_creation_1h_tokens, other(JSON 字符串)`。
- **首字耗时在 `other` JSON 串里**：`frt`（毫秒）。解析时容错（`other` 可能缺失或非 JSON）。
- 参照 UI 的用量列 = `↑prompt ↓completion (+📋cache_creation ⚡cache_read，非 0 才显示)`；类型列 = 流 / 非流（`is_stream`）；推理列 = `reasoning_effort` 或 `reasoning_tokens>0`。

### 2.3 用量统计（日志页头 + 看板卡片）

- `GET /api/log/self/stat` 支持**可选** `start_timestamp/end_timestamp`（实测带窗口返回窗口内口径）：`{data: {quota(费用点数合计), rpm, tpm}}`。
- 不带参数 = 全量口径（实测 quota 值与面板「累计消耗」一致）。

### 2.4 数据看板

- `GET /api/data/self?start_timestamp=&end_timestamp=&default_time=hour|day` → `{data: [ {model_name, created_at(桶起点秒), token_used, count, quota} ]}`（裸数组；实测 hour/day 参数返回同构数据，桶为小时对齐——**插件侧统一请求 hour 桶、客户端按天聚合**，不依赖 fork 的 day 语义）。
- **面板只保留近期数据桶**（实证 7 天窗口仅得数桶）：看板图表须容忍稀疏 / 空数据，并有明确空态文案。
- `GET /api/user/self` 看板相关字段：`quota(余额点数), used_quota(累计消耗点数), request_count(累计请求数), group`。¥ ≈ 点数 ÷ 500000（沿用现有 `formatQuota`）。
- 分组下拉来源：`/api/pricing` 的 `usable_group`（`{"<组名>": "<描述>"}`，键含空串需过滤）与 `group_ratio`。

### 2.5 模型 id ↔ models.dev 匹配事实（R1 匹配规则的设计输入）

- 实证面板账户可见模型 78 个（`GET /api/user/models`）；单 key 可调用集是其子集（`GET /v1/models`，实测某业务分组 key 为 28 个）。
- models.dev（api.json，223 provider）覆盖情况：**78 个 id 中 71 个精确命中**；大小写/标点归一化带来的新增命中为 **0**；未命中 7 个全部是「变体后缀」型：
  - 能力后缀：`gemini-3.6-flash-tiered`、`gemini-3.1-pro-high`（剥后缀即命中基础 id）
  - 日期快照后缀：`qwen3.8-max-0902`（剥后缀命中 `qwen3.8-max`）
  - 渠道命名后缀：`gpt-image-2.5(-sunburst/-flare)`、`grok-imagine*`、`grok-video`（剥后缀后仍无对应条目，属面板特有模型）
- models.dev 条目提供 `modalities.input`、`reasoning`、`reasoning_options`、`limit.context`（上下文窗口）、`limit.output`——知识库「默认上下文窗口」的默认值来源。
- 结论：匹配规则应为「**精确 id → 剥一层尾部变体后缀再精确 → 放弃**」，不做通用模糊匹配（零增益且有误配风险）。

### 2.6 现有代码牵连面

- R1：`src/route-config.ts`（能力写入语义扩展）、`src/capabilities.ts`（models.dev 映射需补 `limit.context`）、`src/client/capabilities.tsx`（重构）、`src/client/locale.ts`、`src/plan.ts`（`SECTION_DEFAULTS` 增字段）、`src/index.ts`（`/capabilities` 语义、同步调用点 `/use` `/models`）。
- R2：`src/index.ts`（`/use` 的 `agent-default-model` 写入、`/state` 的 `defaultModel`、`preferModel` 逻辑）、`src/plan.ts`（`defaultModelAfterSwitch`、`SwitchPlan.defaultModel`）、`src/client/section.tsx`（状态行 / 切换成功文案）、locale 相关键。
- R3：`src/client/section.tsx` 的 `accountLine`。
- 新增：`src/relay.ts` 增 token CRUD 与日志 / 看板 / stat 客户端方法；`src/index.ts` 增对应 fetch 路由；`tests/mock-relay.ts` 增 mock 端点；`package.json` 增图表库依赖，`tsdown.config.ts` 确认图表库打进 client 产物而非 external。

---

## 3. R1 模型能力知识库

### 3.1 数据与语义

【要求】

- 在 `relay` 设置 namespace 新增两个插件自持结构（schemastery dict；随设置热生效，**不随 key 切换丢失**）：
  - **知识库 `capabilityCatalog`**：`{ <知识库模型名>: { input?: string[], reasoning?: false | string[], contextWindow?: number } }`。「模型名」即匹配用的规范名（与 models.dev 命名一致的 id 形态）。
  - **按平台模型覆盖 `capabilityOverrides`**：`{ <面板模型 id>: { 同上，字段可缺省 } }`，用于知识库匹配不到或需个别微调时按 id 显式指定。
- **同步落点规则**（`/use`、`/models` 刷新、能力保存三处共用同一实现，全部走现有 `guardedMutate` 修订守卫 + 字段级合并）：对面板每个模型 id，
  1. `capabilityOverrides` 有该 id → 应用其已定义字段；
  2. 否则知识库匹配成功（§3.2 规则）→ 应用知识库条目已定义字段；
  3. 否则 → **不触碰该条目的能力字段**（保留官方「模型」页或既有手工配置）。
  应用 = 写 `models` 条目的 `input` / `reasoningEfforts` / `contextWindow`（`contextWindow` 来自知识库或覆盖时取代启发式值；启发式仍兜底 `maxTokens` 与未知 id 容量）。
- 语义边界（替代 v0.4.0 的「能力随条目存亡」）：能力配置的持久真源在插件 namespace；路由条目上的能力字段是**派生状态**，每次同步按上述规则重写。**只有插件持有配置的字段才会被插件写**——无配置的 id 上，官方「模型」页手工修改的能力字段不会被同步冲掉；有配置的 id 上，同步会覆盖其能力字段（README 的语义描述同步更新）。

### 3.2 匹配规则

【要求】实现 `matchCatalogName(panelId, catalogNames)`，按序：

1. **精确**：`panelId === 知识库模型名`（大小写敏感）。
2. **剥一层变体后缀**：去掉最后一个 `-` 段后重试精确匹配；仍不中可再剥一层（最多两层）。剥段数在结果中标注 `approximate`。
3. **放弃**：返回未命中。

【要求】能力页对匹配结果可见：每张平台模型卡片标注来源徽标（覆盖 / 知识库名 / 知识库名(近似) / 未配置）。

【建议基线】后缀剥取不设白名单（实证显示误配风险来自多剥层数，两层上限已足够；`qwen3.8-max-0902` 一层命中，`gpt-image-2.5-flare` 两层后仍无对应条目属面板特有模型，落未命中是正确行为）。

### 3.3 能力页 UI（重构）

【要求】

- 页签保持名「模型能力」，内部两段：
  - **知识库**：条目列表（模型名、输入模态、推理、上下文窗口），支持新增（填模型名后 ↻ 从 models.dev 取默认值，含 `limit.context`）、编辑、删除；未收录模型可手工录入全部字段。
  - **平台模型**：当前路由目录逐 id 卡片（沿用现有卡片形态），新增第三行「默认上下文窗口」（数字输入，空 = 不配置），并显示来源徽标；可编辑并保存为该 id 的覆盖配置，也可清除覆盖（回退知识库 / 不配置）。
- 保存语义：一次 POST 同时提交知识库变更与覆盖变更；宿主先落 namespace，再对路由目录整体重放 §3.1 落点规则（一次修订守卫写），返回重放后的模型列表。
- `contextWindow` 校验：正整数；非法值宿主侧拒绝（§12「pi-ai 校验」同款约束）。
- 中英双语；内嵌 webview 约束照旧（无 `window.prompt/confirm`，两段式确认）。

### 3.4 models.dev 集成

【要求】`mapModelsDevEntry` 增加 `limit.context` 提取（供知识库「上下文窗口」默认值）；其余映射逻辑不变；缓存 / 单飞 / 失败降级照旧。

---

## 4. R2 移除默认模型管理

【要求】

- `/use` 不再写 `agent-default-model`；`planSwitch` / `SwitchPlan` 删除默认模型决策（`defaultModelAfterSwitch`、`preferModel` 及「保留上一默认」逻辑一并删除）。
- `/state` 不再返回 `defaultModel`；状态行不再显示「默认模型 X」，改为「已同步 N 个模型 · 当前 key <名>」。
- 切换成功文案去掉「默认模型 X」分句；locale 相关键清理。
- dsh 自身的 `agent-default-model` namespace 保持原样（不写不删——那是宿主自己的配置，用户可在 dsh 界面自行选择）。
- README / README.zh / CHANGELOG 相应更新。

---

## 5. R3 账户行精简

【要求】API Keys 页签账户行只保留 `用户名 · 余额 ¥X`；「分组 / 倍率」从账户行移除（单条 key 行上的分组 / 倍率信息**保留**，那是 key 级有用信息）。locale 键随清理。

---

## 6. R4 API key 增删改

【要求】

- 宿主 `relay.ts` 新增管理调用：`createToken(payload)`、`updateToken(payload)`、`deleteToken(id)`（§2.1 形状；更新必须以现值为基整体回传）。
- 新增 fetch 路由（dsh 一 path 一路由，POST 子路径各自独立）：
  - `POST /api/relay/keys-create`：body `{name, group, unlimitedQuota, remainQuota?, expiredTime?|-1}` → 宿主调创建接口。**响应不得包含 key 明文**——服务端生成的 `data.key` 在宿主侧剥离；推荐前端提供「创建并设为生效」（创建成功后按名称走既有 `/use` 切换，明文只经服务端进凭据文件）。
  - `POST /api/relay/keys-update`：body 带 `id` 与变更字段；宿主先读现值合并后 PUT。
  - `POST /api/relay/keys-delete`：body `{id}`；目标为当前生效 key 时响应带 `active: true` 警示字段，前端两段式确认。
- UI（API Keys 页签）：列表尾部「+ 新建 key」内联表单（名称必填、分组下拉必填——数据源 `usable_group` 过滤空键、额度（不限 / 指定点数，附 ¥ 提示）、有效期（永久 / 选日期））；每行新增「编辑」「删除」；编辑表单同创建 + 启用 / 禁用切换。所有操作后刷新列表。
- 校验：名称 / 分组必填；额度与过期时间非法值宿主侧拒绝；错误经 `message` 透传给前端。

【建议基线】模型限制（`model_limits`）与 IP 白名单等高级字段不进表单，UI 不展示（保持范围收敛；接口透传不受影响）。

---

## 7. R5 + R6 数据看板与使用日志

### 7.1 数据看板（新页签，排序在「模型能力」之前）

【要求】

- 宿主路由：`GET /api/relay/dashboard?days=7`——宿主聚合 `/api/user/self`、`/api/log/self/stat`（今日窗口）、`/api/data/self`（近 N 天 hour 桶）为一个响应 `{balance, todayUsed, totalUsed, totalRequests, buckets: [{date, model, quota, tokens}]}`（桶已按天聚合、¥ 换算完成）。
- 卡片：当前余额（`self.quota`）、今日消耗（今日窗口 stat.quota，附今日请求数或 tokens 其一）、累计消耗（`self.used_quota`）、累计请求数（`self.request_count`）。
- 图表：近 7 天按模型的**堆叠柱状图**，右上「消耗金额 / Token 量」口径切换；图例为模型名。**用成熟的 React 图表库实现（允许新增此一处运行时依赖），打进 `lib/client.js`**（react 仍外置，client externals 不变）；配色用宿主 design token。
- 【建议基线】图表库选 recharts（MIT、声明式、React 18 组合成熟）；按需导入所需组件控制包体，client 产物体积变化在报告中说明。
- 稀疏 / 空数据（§2.4 面板保留期有限）必须有可读空态；某天缺桶不补零也行，但坐标轴须可读。

### 7.2 使用日志（新页签，排序在「数据看板」之后）

【要求】

- 宿主路由：`GET /api/relay/logs`（分页与筛选参数透传面板 `/api/log/self`，`other` 在宿主侧解析出 `frt` 后随条目返回）；`GET /api/relay/logs-stat?start&end`（透传 stat，供页头）。
- 页头：`用量 ¥X · RPM X · TPM X`（stat，窗口=当前筛选时间范围）。
- 筛选：时间范围（默认本月，可改起止）、模型名称（下拉，数据源 `/api/user/models`）、密钥名称（下拉，数据源 key 列表）、分组（下拉，`usable_group`）；「查询 / 重置」。
- 表格列：时间 / API 密钥 / 分组 / 模型 / 类型（流 / 非流）/ 用量（`↑prompt ↓completion`，cache 读写与 reasoning tokens 非 0 时附加小字）/ 耗时（首字 `frt` 秒 + 总 `use_time` 秒）/ 费用（¥）；分页控件（每页 10，`共 N 条`，上一页 / 下一页）。
- 时间范围、分页状态在前端维护；筛选变更后需手动点「查询」才发起（对齐参照 UI 习惯）。

### 7.3 参照与形态

【要求】信息架构（卡片措辞、堆叠图、日志表格列、筛选与分页布局）以参考图为准：`docs/local-assets/dashboard-reference.png`（数据看板）与 `docs/local-assets/logs-reference.png`（使用日志）——含真实账号数据，gitignored，不得外传或嵌入任何交付物；实现形态适配设置对话框宽度（约 760px 内容区），不照搬整页布局。中英双语。

---

## 8. R8 dev 启动器 --no-open

【要求】

- 实证（`dsh web --help`）：安装的 dsh 支持 `--no-open`（"do not open the Web UI in the default browser"）；`scripts/dev.js` 目前未透传，每次 `npm start` 都会拉起系统默认浏览器。
- `scripts/dev.js` 新增 `--no-open` 旗标：出现即向 dsh web 追加 `--no-open`；不传时行为不变。解析方式沿用现有 `--dsh-home` / `--port` 的轻量解析；`resolveDevHome` / `resolveDshEntry` 等既有导出与测试不受影响。
- 为旗标解析补一条 dev-home 单测（透传与否均断言）。

【建议基线】AGENTS.md §6 与 README 开发小节同步提及该旗标；浏览器验收场景起实例一律带 `--no-open`，避免弹多余标签页。

---

## 9. 测试与验收

【要求】全部在隔离环境完成（隔离 home 从零创建 + 独立端口；mock 面板扩展）：

1. **mock 面板扩展**（`tests/mock-relay.ts`）：`POST/PUT/DELETE /api/token/`（含「分组不能为空」类校验行为）、`/api/log/self`（含 `other.frt`、cache/reasoning 字段的 fixture）、`/api/log/self/stat`（带 / 不带窗口）、`/api/data/self`（稀疏桶 fixture）。
2. **单测**：匹配规则（精确 / 一层剥段命中并标注 approximate / 两层 / 未命中 / 剥段后误配防护）；§3.1 落点规则（覆盖 > 知识库 > 不触碰；contextWindow 取代启发式；无配置 id 的手工字段保留）；「key 切换后配置仍在 + 新 key 目录同步时重放」（fake-settings 回归）；日志整形（frt 毫秒→秒、cache 小字、`other` 容错）；看板按天聚合与空态；token 创建响应剥离 key 明文；dev 旗标解析（`--no-open` 透传与否）（**断言 HTTP 响应与日志无 sk- 材料**）。
3. **浏览器验收**：六页签顺序；能力页知识库增删改 + ↻ 取默认值 + 平台卡片覆盖 / 清除 + 来源徽标；同步后 dsh 模型条目落盘断言（contextWindow / input / reasoningEfforts 精确）；key 新建（表单校验、创建并设为生效）/ 编辑（改名 / 换组 / 额度 / 有效期 / 启停）/ 删除（两段式、生效 key 警示）；看板图表渲染与口径切换；日志筛选 / 分页 / 首字耗时展示；中英双语各走查一遍。
4. **真实账号验收**（配置见 `docs/local.md`）：只读项随意（模型 id、日志、看板、stat 与面板控制台数值对账）；**写路径用一次性临时 key**（`dsh-temp-` 前缀）走 创建 → 编辑 → 删除 闭环，验收后面板无残留；既有 key 一律不碰。
5. 质量门：typecheck 0 error → vitest 全绿 → 浏览器验收过 → 自起进程按 PID 杀净 → `.tmp/` 清理（保留真实 home 备份）→ `git status` 无杂物。

---

## 10. 文档交付

`README.md` / `README.zh.md`：六页签更新、能力知识库语义（替代「字段级合并互不覆盖」的旧表述）、key 管理与看板 / 日志说明、新截图；`CHANGELOG.md` 0.5.0 条目；`AGENTS.md` §1 项目定位与 §5 协议事实同步（token CRUD / 日志 / 看板 / stat、匹配规则）；`docs/WORKLOG.md` 追加条目；`assets/` 截图与 `screenshots.json` 更新（mock 数据重拍）。

## 11. 完成定义（DoD 自检单）

- [ ] 六页签（连接 / API Keys / 模型 / 数据看板 / 使用日志 / 模型能力）顺序与功能齐全，中英双语
- [ ] 能力知识库与按 id 覆盖持久于插件 namespace，key 切换不丢；同步落点规则与匹配规则有单测；落盘断言通过
- [ ] 默认模型逻辑与文案全部移除；账户行只剩用户名 + 余额
- [ ] `npm start -- --no-open` 不拉起浏览器（旗标解析有单测）
- [ ] key 创建 / 编辑 / 删除可用；key 明文不出现在任何响应、日志、测试快照
- [ ] 看板 / 日志两页签按参考图实现；图表以图表库实现并打进 client 产物（除图表库外零新增运行时依赖，react 仍外置）
- [ ] 真实账号：只读对账完成；临时 key 三步闭环无残留
- [ ] typecheck + 测试全绿；浏览器中英走查通过；mock 面板覆盖新端点
- [ ] 文档五件套更新；截图重拍
- [ ] 工作区外零改动；清理完成；commit 按操作者指示

## 12. 风险与提示

- **图表库包体**：按需导入（如 recharts 只引图表/坐标轴/Tooltip 所需件），client 产物体积变化写进报告；图表库不进 externals，build-shape 测试的 externals 断言保持 react 系不变。

- **fork 偏差**：§2 事实来自实证面板（fork）；上游 new-api 演进可能不同。一切以 `docs/local.md` 指向的面板实测为准；探到与 §2 冲突的事实先更新本文件再动代码。
- **创建 key 的明文边界**：创建响应含 `data.key` 明文，宿主剥离后只用于「创建并设为生效」的服务端凭据写入；若实现「复制 key」类功能即违反密钥红线——不做。
- **`other` 字段是 JSON 字符串**：解析容错（缺失 / 非 JSON / 字段改名时降级为「—」），不能因它让日志页 500。
- **看板数据保留期有限**：面板只存近期桶，图表勿假设 7 天全有数据；空态是常态路径而非异常路径。
- **能力派生语义变化**：有插件配置的 id 上，同步会覆盖官方「模型」页改的能力字段——README 与设置页文案都要写清楚，避免用户误判为 bug。
- **pi-ai 校验**：`contextWindow` 非法值会被 settings 校验拒绝，宿主侧先校验；`models` 数组整体替换语义不变，一切写走 `guardedMutate`。
- **stat 的今日口径**：以 `start_timestamp=今日零点` 实测值为准，勿用「不带参数=今日」的假设（实测不带参数是全量口径）。
