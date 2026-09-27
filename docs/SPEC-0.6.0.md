# dsh-plugin-relay → v0.6.0 开发任务书（Spec）

> **状态：已定稿——预置口径与粒度、四项优化清单、多套中转站设计均已操作者确认（§9 设计来源：
> 操作者 2026-09-28）；未实施。** §2 的全部事实来自 2026-09-27/28 对操作者真实面板
> （只读）与 models.dev 的实测分析、仓库源码核对，可直接引用。
> 实施前必读：仓库根 `AGENTS.md`、`docs/SPEC-0.5.1.md`（现行实现）、`docs/local.md`（研究原始数据）。

---

## 0. 执行守则

1. SPEC-0.5.1 §0 的全部硬性约束继续有效（不碰操作者 dsh home 与实例、只按 PID 杀自己起的
   进程、隔离 home 从零创建、密钥与测试信息不入 git/报告/工具输出、settings 写入必须 await、
   工作区外零文件改动、**commit 按操作者指示**——当前约定：0.6.0 全部完成（含发布前检查）
   后由执行会话提交代码，push 由操作者自行执行）。
5. **执行会话为全新会话**：本文件自包含，按 §3-§9 顺序实施即可，无需本会话之外的上下文。
6. **无旧版兼容负担**：插件未正式发布，schema 直接为新格式，不写迁移代码；本地
   `.dsh-home/settings.yaml` 由实施会话**直接改写**为新格式（操作者已授权；改写属红线 4
   的"写入需报告"范畴——实施报告必须列明改了什么）。
2. `deepseek-harness/` 仍为只读参考。3. 正确性 > 便捷性；不确定的事实读源码或联网查证。
4. 本版为 **minor 发版**：含预置基线口径重构、maxTokens 能力字段、连接测试、图表重写等
   功能增强；`relay` namespace schema 仅新增可选键（0.5.1 先例，向后兼容）。

## 1. 背景与目标

v0.5.1 交付后的三股输入汇成 0.6.0：

1. **预置知识库口径修正**（操作者设想重述）：编译期从 models.dev 获取**「主流」模型**能力
   数据；面板 pricing 只用于研究分析（推导规范化规则与主流判定），不再是基线数据源；
   运行时把面板模型 id 经规范化规则与预置匹配。规范化规则与「主流」判定均有实证
   （§2.1-§2.3，操作者已逐项审定：面板源移除、1 年窗口、剔除非对话、渠道去重、k3 别名）。
2. **评审发现的缺陷**：「刷新预置」不重放路由（§2.5），必须修复。
3. **操作者选定的优化清单**：maxTokens 能力字段、连接测试按钮、手写 SVG 图表替换 recharts、
   体验小赢集合（§5-§8）；**多套中转站**（§9，设计已定稿：多站同时生效、名称即提供方 ID、
   连接列表 + 二级页面）。

已评估**不做**（避免后续重复讨论）：Tab 记忆与加载失败重试按钮、HTTP 重试/可配置超时、
key 列表分页（>100 keys）、日志 CSV 导出与页大小、面板余额阈值提醒、key 明文复制（安全红线）、
自动探测用户 ID（风控风险，0.3.0 已论证）。

## 2. 已核实事实（2026-09-27/28）

### 2.1 现行匹配的真实命中率与 miss 形态

- v0.5.1 规则（精确 → 剥 1-2 层后缀，区分大小写，面板源参与）对面板 83 ids 命中 80
  （75 精确 + 5 剥一层）；3 个未命中全是图像/视频生成类（models.dev 不收录）。
- 以 first-party 白名单（§3.1）为基线时 83 ids 命中 71，12 个 miss 实锤为四类形态：

| 形态 | 实证（面板 id ↔ models.dev 规范名） | 规则 |
|---|---|---|
| 大小写 | `minimax-m3` ↔ `MiniMax-M3`（全库共 19 对同模型异写） | 大小写折叠 |
| 版本分隔符 | `claude-fable-5.1` ↔ `claude-fable-5-1` | 版本号 `.`↔`-` 双向归一 |
| 缺变体后缀 | `gemini-3.1-pro` ↔ `gemini-3.1-pro-preview`、`gemini-3-flash` ↔ `gemini-3-flash-preview` | 唯一候选变体补全 |
| 不收录/渠道命名 | `k3`（= `kimi-k3` 尾段）、`gpt-image-2.5` 系、`grok-video`、`grok-imagine` | 别名表 / 放弃 |

- 提议规则集（L0-L5，§3.3）在此基线上命中 **76/83**。

### 2.2 「主流」判定的数据基础

- **家族分布**（83 ids）：claude 16、gemini 16、grok 10、gpt 10、qwen3 9、deepseek 6、glm 5、
  kimi 4、minimax 4、mimo 2、其它 1 —— 11 个家族全部映射到 models.dev 的 first-party 作者
  provider（聚合渠道商如 llmgateway/302ai 命中极多但不是模型作者，不能作主流依据）。
- **发布时间**：≤90 天 38、91-183 天 19、184-365 天 23、>365 天 0。v0.5.1 的 183 天窗口会
  砍掉 28% 主力模型。操作者审定窗口 **1 年**——已知代价：`gemini-2.5` 全家（2025-06-17，
  ~468 天）出窗。
- **用量信号（可选）**：OpenRouter JSON API
  `GET https://openrouter.ai/api/v1/datasets/rankings-daily`（每日 top-50 token 用量，
  `model_permaslug`/`total_tokens`，需免费注册 key，CC BY 4.0，30 req/min）可兜底白名单漏网
  的新势力模型；无 key 功能完整。

### 2.3 基线漏斗（操作者两轮审定后的最终口径）

first-party 白名单全量 **316 规范名**（清单已存档 docs/local.md）→ **365 天窗口** 184 →
**剔除非对话**（embedding/tts/image/video/music，modalities 与名字形态双重判定）−18 → 166 →
**渠道重复登记去重**（strip `@渠道` 后缀、`vendor/` 前缀、`-maas` 后缀后与库内其它条目同名者
丢弃 −20；stripped 名不存在其它条目者以裸名 **rekey** 7 条，如
`xai/grok-4.20-reasoning → grok-4.20-reasoning`、`siliconflow/deepseek-v3.2 → deepseek-v3.2`）→
**最终基线 ≈ 145 条**（google 28 / qwen 29 / openai 22 / anthropic 15 / mistral 11 / glm 11 /
mimo 9 / xai 8 / minimax 6 / deepseek 4 / kimi 2）。产物 ~9KB，宿主产物 113KB → ~122KB。

重要反直觉事实（写进规则防止误删）：`claude-opus-5-5` 的唯一登记形态是 google 的
`claude-opus-5-5@default`；`gpt-oss-*`、`meta/llama-*`、`deepseek-v3.2-maas` 仅有 MaaS 转挂
条目——rekey 机制保证这类模型不丢。日期戳快照（`claude-sonnet-4-5-20250929`）是面板实际
售卖的 id 形态，保留。面板 83 ids 对该基线命中预估 **67/83**（含 k3 别名；miss 16 个 =
图像视频类 10 个 + gemini-2.5 系出窗 3 个 + 渠道形态 2 个 + 1 个）。

### 2.4 OpenRouter 兜底的边界

仅 `preset:fetch` 支持（环境变量 `OPENROUTER_API_KEY`）；运行时刷新不引入新凭据；无 key
时白名单即完整降级。

### 2.5 「刷新预置」不重放路由（v0.5.1 缺口，源码核实）

`POST /api/relay/knowledge-refresh` 只重建 `runtimePreset` 内存层，**没有调用**
`replayRouteCapabilities`——能力页展示的派生值是即时计算的（看起来生效了），但决定实际请求
行为的 `llm-pi-ai.providers.relay.models[n]` 字段要等下次切 key / 模型同步 / 能力保存才更新。
`POST /api/relay/capabilities`（applyCapabilityOps）有重放，两者行为不一致。

### 2.6 maxTokens 的数据与现状

- models.dev 条目带 `limit.output`（输出上限），现网数据普遍存在；`mapModelsDevEntry` 目前
  **只读 `limit.context`**（源码核实）。
- 路由条目的 `maxTokens` 现状靠启发式（默认 8192 / 按家族推断），推理模型常被高估或低估，
  直接影响请求质量。知识库持有配置时可精确覆盖（同 contextWindow 的既有语义）。

### 2.7 图表体积归因与连接错误形态

- client 产物 983KB（minified）中 recharts 及其依赖树占 ~78%（sourcemap 逐字节归因）；
  dashboard 仅使用「按日堆叠柱状图」一种图表。
- 面板连接错误形态（mock 与真实面板一致）：HTTP 401 + 消息「token 无效」= 令牌错；
  HTTP 401 + 消息含「New-Api-User … 不匹配」= 用户 ID 不配对；网络层异常 = 地址/代理问题。
  `HttpError.detail` 已携带面板原始 message，`relay.ts` 管道可直接分类。
- dashboard 的 `?days=` 参数宿主已支持 1-30，客户端写死 `days=7`（源码核实）。

## 3. R1 预置知识库：主流基线与匹配升级（已审定）

### 3.1 主流判定规则

- **A. first-party 作者 provider 白名单**（编译期清单，12 家族 → models.dev provider keys）：
  openai / anthropic / google + google-vertex / xai / deepseek / alibaba + alibaba-cn /
  moonshotai + moonshotai-cn / zai + zhipuai / minimax + minimax-cn / xiaomi / mistral。
- **A2. 非对话模型不入册**（embedding/tts/image/video/music，modalities 与名字形态双重判定）。
- **A3. 渠道重复登记去重**：候选名剥离（`@渠道` 后缀 / `vendor/` 前缀 / `-maas` 后缀）后与
  库内其它条目同名 → 丢弃；无同名 → 以裸名 rekey（§2.3，−20 / rekey 7）。
- **B.（可选）OpenRouter 用量兜底**：`preset:fetch` 支持 `OPENROUTER_API_KEY` 环境变量，拉
  `rankings-daily` 近 7 天 top-50 的 `model_permaslug` 并入（map 回 models.dev 名：精确 /
  casefold）；未提供时跳过并注明。运行时刷新不引入新凭据。
- **C. 发布时间窗 1 年**：`PRESET_MAX_AGE_DAYS` 183 → **365**；`release_date` 缺失不入册。
  已知代价：gemini-2.5 系出窗（操作者知情）。
- **D. curated 别名表**（默认仅一条实证）：`{ k3 → kimi-k3 }`；每条人工确认唯一性；命中
  标记 approximate。

### 3.2 面板源移除

- `preset:fetch` 删除 `--panel` 参数与 `.dsh-home` 解析、删除 pricing 拉取；产物头改为
  「models.dev 日期 + provider 数 + 条数 +（可选）openrouter 日期」，**不含任何面板信息**。
- `POST /api/relay/knowledge-refresh` 同步删除面板分支。面板从此只是**被匹配对象**。
- `src/knowledge-preset.ts`：`buildPresetEntries` 签名改 `(doc, options)`；`panelModelNames`
  删除；`PRESET_MAX_AGE_DAYS` → 365；新增别名表常量；`dropped` 列表排序稳定（v0.5.1 已修，
  回归保持）。

### 3.3 运行时匹配规则升级（knowledge.ts）

层级全等匹配（无模糊/包含），层级顺序：

- L0 精确（现行）；
- L1 大小写折叠精确（折叠后多个候选则放弃）；
- L2 剥 1-2 层 `-` 后缀（现行；原样与折叠各试一轮）；
- L3 版本分隔符双向（`(\d).(\d)`↔`(\d)-(\d)` 互换后走 L0/L1）；
- L4 唯一变体补全（面板 id（含剥层后）+ 恰一个变体 token（`preview`/`latest`/`exp`）恰为
  某规范名，且候选唯一）；
- L5 curated 别名表直查（§3.1-D）。

**来源标记**：L0 exact；L1-L5 一律 approximate（UI 徽标与「匹配：…（近似）」提示已有）。
**回归不变量不变**：未命中不触碰条目；命中只写插件持有配置的字段；手工字段永不被冲掉。
误配面评估（写进测试注释）：折叠/剥层要求全等 + 候选唯一，实证 19 对均为同模型异写；
L3 双向互换在双形态同时收录时候选不唯一自动放弃；L4 变体表固定且唯一性约束拦截
`gemini-3-pro-image-preview` 类多候选场景。

## 4. R2 刷新预置自动重放（缺陷修复）

`knowledge-refresh` 在重建 `runtimePreset` 后**必须** `await replayRouteCapabilities(...)`
（与 applyCapabilityOps 同一守卫语义），并返回 `{ ok, count, replayed: boolean }`。失败
（如 SETTINGS_CONFLICT 重试耗尽）返回可读错误但不回滚内存层。UI 通告文案更新为
「已刷新预置（N 条）并同步到模型目录」。

## 5. R3 maxTokens 进能力体系

1. **schema**：`CapabilityEntrySchema` 新增可选 `maxTokens: Schema.number()`（additive，
   向后兼容）；`CatalogEntry` / `PresetEntry` / 派生视图同步加字段。
2. **数据**：`mapModelsDevEntry` 提取 `limit.output`（正整数才收）；`mergeSuggestions` 对
   maxTokens 取最大（与 contextWindow 同策略）。
3. **校验**：`validateCapabilityEntry` 增 maxTokens 规则——正整数、≤ 1,048,576；空值合法。
4. **重放**：`applyDerivedCapabilities` 在 `derived.maxTokens !== undefined` 时写
   `next.maxTokens`；未配置时**不触碰**（回落现有启发式，清除配置即回落，语义同 contextWindow）。
5. **UI**：能力编辑卡（我的条目 / 平台卡共用 CapabilityFields）增加「输出上限」文本框，
   复用 `parseContextWindow`（K/M 简写同规则，上限 1,048,576），实时换算 hint；摘要
   （entrySummary）追加输出段（新 locale 键，缺省省略）。
6. **预估**：现网数据 limit.output 覆盖率实施时验证（若低于预期在报告说明，不影响字段设计）。

## 6. R4 连接测试按钮

1. **host**：`POST /api/relay/connection-test`——用当前已保存设置调 `relay.self()`，成功返回
   `{ ok, account: { username, quotaCny } }`；失败按 §2.7 分类：
   - 网络层异常 → `unreachable`（无法连接面板，检查地址/网络/代理）；
   - HTTP 401 + detail 含「New-Api-User」或「不匹配」→ `user-mismatch`（用户 ID 不配对）；
   - HTTP 401 其它 → `token-invalid`（访问令牌无效）；
   - 其它 → `error:<detail>`。
2. **UI**：Connection 页保存按钮旁加「测试连接」outline 按钮（三项配置齐备才可用：token 以
   `state.accessTokenConfigured` 判断）；结果走现有 message 区（成功显示账号名与余额）。
   保存后**不自动**触发（避免每次保存打面板）。
3. **locale**：测试按钮 / 四类结果文案中英双份。

## 7. R5 手写 SVG 堆叠图替换 recharts

1. **组件**：`client/dashboard-chart.tsx` 内实现堆叠柱状图——每模型一色（复用
   `useChartPalette` 的 token 配色）、X 轴日期（按天数自适应抽稀标签）、Y 轴 4-5 个整数刻度
   （¥ 用 `¥N`、token 用 `tokenCountText`）、原生 `<title>` 悬停提示（`模型 · 日期 · ¥x / N tok`）、
   可点击图例显隐系列（纯客户端过滤）、空态沿用现有 empty 组件。
2. **纯函数**：刻度计算与布局抽取为可测纯函数（vitest 直测，不依赖 DOM）。
3. **依赖清理**：devDependencies 移除 `recharts`；tsdown client 的
   `define: process.env.NODE_ENV` 随之删除（bundle 不再有依赖树内的 NODE_ENV 守卫）；
   `pivotBuckets` 保留复用。
4. **体积目标**：client.js 983KB → **≤ 350KB**（minified；验收断言上限，防止回退）。
   视觉走查对比 recharts 版（对齐、图例、悬停），不满意不合并。

## 8. R6 体验小赢集合

1. **看板天数**：Pill 组 7 / 14 / 30 天，切换重新拉 `?days=N`（locale 键三个）。
2. **预置覆盖率指示**：平台模型区标题右侧显示「N 个：预置 X · 知识库 Y · 覆盖 Z · 未配置 W」
   （由 caps.models 的 source 统计；locale 键一份带参数模板）。
3. **摘要 1M 化**：entrySummary 的上下文段用 `tokenCountText`（1048576 → 1M）。

## 9. R7 多套中转站（设计定稿，来源：操作者 2026-09-28）

目标：连接 tab 管理多套中转站，**多套同时生效**——每套是 pi-ai 里一个独立的自定义提供方
（模型选择器中同时可见、按提供方+模型选择），不是一个切换器。主面板只保留「连接」与
「模型能力」两个 tab。

### 9.1 信息架构

- **主面板**：①「连接」= 中转站列表（增删改 + 行内编辑 + 删除 Modal + 二级页面入口）；
  ②「模型能力」= 现有能力页，其中平台模型分区**按中转站分组**。
- **二级页面**：点击一个中转站行进入——顶部为「← 返回」+ 面板名 + 状态行 + 测试按钮；
  下挂四个 tab：**API Keys / 模型 / 数据看板 / 使用日志**（现有四个组件原样迁入，仅数据
  源增加 panel 参数）。

### 9.2 数据模型

- `relay.panels: Record<id, PanelConfig>`，`PanelConfig = { id, baseUrl, relayKind,
  accessToken(secret), userId, keyRef, selectedKeyName }`。**id 即自定义提供方的 ID 与名称**：
  pi-ai 路由键 = 规范化 id，路由 `displayName` = id 原文；创建时可填、创建后**不可改名**
  （改名牵动路由/凭据/覆盖三处迁移，需要时删除重建），规范
  `[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}` 且唯一。
- **不做旧版兼容/迁移**（插件未正式发布）：schema 直接为新格式，legacy 平铺字段删除；
  本地 `.dsh-home/settings.yaml` 由维护者直接改写为新格式（操作者已授权）。
- 凭据引用 `keyRef` **存储在 PanelConfig**（非推导）：创建时按
  `RELAY_API_KEY_<ID 大写规范化>` 自动生成并做唯一性去重，首面板常见即 `RELAY_API_KEY_<ID>`；
  首次「使用」时写入凭据（现行语义）。
- 能力覆盖改为**按面板分组**：`capabilityOverrides: Record<panelId, Record<modelId, entry>>`；
  知识库与预置层保持全局（按模型名匹配，与面板无关）。
- **嵌套 secret 红线校验（实施第一步）**：dict 内 `role('secret')` 的 accessToken 必须在
  describe/wire 上仍被脱敏——先写 describe 断言 + 走查确认；若嵌套脱敏失效，回退方案 =
  面板访问令牌迁移到凭据引用（credentialsService，天然不回显）。

### 9.3 宿主路由

- 面板 CRUD：`GET /api/relay/panels`（列表摘要：id / baseUrl host / 账户名 / 余额 / 模型数 /
  当前 key / 配置完整度）；`POST /api/relay/panels-create|panels-update|panels-delete`
  （update 为定向字段 ops，语义同 keys-update）。
- 删除 = 确认 Modal（正文列明清理范围）→ unset pi-ai 路由 `providers.<id>` + 删除该面板的
  overrides 分组 + 尝试清空凭据引用；**不删**全局知识库条目。
- 现有 per-panel 路由全部增加 `panel` 参数：keys / keys-create|update|delete / use / models /
  dashboard / logs / logs-stat / logs-meta / connection-test；host 据此取该面板的连接配置与
  路由名。`panel` 参数缺省时：仅有一个面板则用它，否则报错（客户端总是显式携带）。
- 能力 ops（POST /capabilities）：`overrideSet` / `overrideDelete` 增加 `panel` 字段寻址
  `capabilityOverrides.<panel>.<id>`；`catalogSet` / `catalogDelete` 保持全局。
- 刷新预置（R2）重放改为**逐面板**执行（每个已配置路由一次守卫重放）。

### 9.4 UI

- 连接列表行：StateDot（配置齐备=done，缺项=error）+ 名称 + baseUrl host + 元信息
  （账户 · 余额 · 模型数 · 当前 key）+ 操作：测试 / 编辑 / 删除；点击行进入二级页面；
  「+ 新增」右上（与 keys 页同款）。
- 编辑卡（原地展开，一次一张）：名称（创建可填 / 编辑只读）、API 地址、访问令牌
  （write-only）、用户 ID；页脚 取消 / 应用（应用即写、失败卡不收，同 keys 卡）。
- 删除 Modal 正文列明清理范围（路由 / 该面板能力覆盖 / 凭据引用）。
- 能力页平台模型：按面板分小节（小节标题 = 面板名 + 覆盖率指示），卡片语义不变
  （override 寻址到该面板）。
- 截图影响：连接页变为列表、keys/模型/看板/日志截图变为二级页形态——assets 中英全套重拍。

## 10. 测试与验收

1. **单测**（fixture 全部用 models.dev 公开模型名，面板 id 清单不入 git）：
   - 匹配层级矩阵：§2.1 四类形态逐一断言（casefold、version-sep 双向、variant-complete
     唯一性、多候选放弃）；现行 strip 行为回归；`k3` 别名命中；
   - `buildPresetEntries(doc, options)`：白名单并集、365 天窗口、非对话剔除、渠道去重
     （丢弃与 rekey 两分支）、别名表；OpenRouter 分支以注入 fixture 测试并入与降级；
   - maxTokens：提取/合并/校验/重放矩阵（未配置不触碰、清除回落启发式）；
   - 刷新重放：knowledge-refresh 处理器级测试（FakeSettings）断言路由条目被重放；
   - 连接测试：四类错误分类矩阵（mock 面板原生支持 401 两形态）；
   - 多面板：面板 CRUD 处理器（create/update/delete 的 ops 形状、id 规范化与唯一性冲突、
     keyRef 生成去重、删除清理路由与 overrides 分组的落盘断言）；双 mock 面板实例同时生效
     （两路由并存、目录各自同步）；嵌套 secret describe 脱敏断言；
   - 图表：刻度/布局纯函数矩阵；
   - build-shape：client 体积上限断言（≤350KB minified）+ 既有外置白名单审计。
2. **脚本实跑**：无 key 跑一次（基线 ~145 条，报告 provider 数/条数/体积）；有 key 时对比
   OpenRouter 并入增量。
3. **浏览器验收**（隔离 home + mock + 中英）：主页两 tab + 二级页四 tab 回归；连接列表
   CRUD（行内编辑 / Modal 删除 / 二级页进入返回）+ 双面板同时生效（模型选择器两个提供方）
   + 删除清理；能力页预置折叠区（~145 条）与
   过滤；平台卡匹配徽标（mock 含小写 id / `x.1` 式 id / 缺 preview id 三类）；maxTokens
   编辑与落盘断言（settings.yaml 精确断言，含清除回落）；完成即存回归；连接测试四态
   （mock 面板造坏 token / 坏 userId / 正常）；看板 7/14/30 切换 + SVG 图视觉走查（对齐/
   图例/悬停/图例显隐）；覆盖率指示数字正确。
4. **真实账号**：只读对账（预置命中数变化前后对比、maxTokens 抽查、连接测试实跑一次成功态）；
   临时 key 写闭环不涉及本版改动（0.5.1 已验）。写路径：maxTokens 保存走隔离 home。
5. 质量门：typecheck / vitest / build 全绿；历史专名哨兵审计通过。
6. **发布前检查（实施与验收全部完成后执行）**：
   - `package.json` bump 到 **0.6.0**；
   - 公开文件审计：对全部跟踪文件（含新增）按身份哨兵清单（历史专名 / 真实分组名 / 用户 ID /
     面板地址 / 本机路径 / sk- 令牌形状 / 余额快照）`git grep` 零命中；
   - `npm pack` 内容审计：文件齐全必要（无 src/tests/docs/.github）、内容零敏感串；
   - git status 无杂物后**提交代码**（不 push）。

## 11. 文档交付

README 中英：多面板信息架构（连接列表 + 二级页面）重写连接章节、预置知识库改为「主流模型」
口径、maxTokens 字段说明、连接测试、看板天数、Compatibility 不变；assets 截图全套重拍
（主页两 tab + 二级页四 tab × 中英）；CHANGELOG 0.6.0（含 v0.5.1→0.6.0 的全部变更，注明预置基线口径变更与
面板命中率预期变化 80 → 67/83）；AGENTS §1/§2/§3/§8（预置层语义、匹配层级、maxTokens、
preset:fetch 管线、工作流三件套）；PUBLISHING §7（基线维护自动化）；WORKLOG 0.6.0 条目
（研究结论、操作者决策记录、多面板占位）。

## 12. 完成定义（DoD 自检单）

- [ ] 预置基线 = models.dev 主流（first-party − 365 天窗外 − 非对话 − 渠道重复，≈145 条），
      脚本与刷新路由不再读面板；OpenRouter 可选兜底；k3 别名
- [ ] 匹配层级 L0-L5 落地 + 矩阵单测；L1-L5 标 approximate；回归不变量保持
- [ ] 刷新预置自动重放路由（处理级测试断言）
- [ ] maxTokens：schema 可选键 / 提取 / 校验 / 重放 / UI / 清除回落启发式，落盘断言
- [ ] 连接测试按钮四态分类 + 中英文案
- [ ] recharts 移除，SVG 堆叠图视觉走查通过，client.js ≤ 350KB（minified）断言进 build-shape
- [ ] 看板 7/14/30、覆盖率指示、1M 摘要
- [ ] 多面板：连接列表 CRUD（行内编辑 / Modal 删除）+ 二级页四 tab + 双面板同时生效 +
      删除清理落盘断言 + 嵌套 secret 脱敏验证（无迁移兼容——未发布，本地 home 直接改写）
- [ ] 文档五处同步；typecheck/vitest/build 全绿；浏览器中英走查；真实账号只读对账；
      本地 `.dsh-home` 已改写为新格式（报告列明变更）
- [ ] 版本 bump 0.6.0；公开文件身份审计零命中；npm pack 内容审计通过；提交代码（不 push）

## 13. 风险与提示

- **基线口径变更是一次性行为变化**：v0.5.1 基线（97 条，面板派生参与）→ 145 条（纯主流）。
  面板命中率 80 → 67/83；出窗的 gemini-2.5 系与图像视频类模型回落「未配置」，用户可自建
  条目或等「刷新预置」（同规则）。README 与 CHANGELOG 需明示。
- **preset-refresh workflow 的 PR 语义随 R1 收敛**：0.6.0 落地后每周 diff 即纯 models.dev
  漂移（workflow 注释与 PUBLISHING §7 的过渡期说明届时删除）。
- **SVG 图表的边界**：只承诺现有 dashboard 的一种图；不试图做通用图表库。视觉走查不达标
  不合并（recharts 回退方案保留到合并前）。
- **maxTokens 的写语义**与 contextWindow 完全同构（未配置不触碰、清除回落启发式），不引入
  新的合并语义。
- **多面板是 0.6.0 最大的结构变量**：头号实施风险是 dict 内嵌 secret 的脱敏行为（§9.2
  已备回退方案：面板令牌迁移凭据引用）；其余各节实施时避免与多面板方向冲突（namespace /
  凭据 / 路由的扩展点预留）。多面板下「删除面板」影响 dsh 会话的模型可见性（其提供方整体
  消失），删除 Modal 文案需明示。
