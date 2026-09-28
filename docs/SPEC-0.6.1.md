# dsh-plugin-relay → v0.6.1 开发任务书（Spec）

> **状态：已定稿——四项开放决策（折叠形态 / 预置持久化形态 / 图表增强范围 / 低价值项取舍）经操作者
> 2026-09-28 选择确认；未实施。** 前置：v0.6.0（commit f5c3fcf）已交付未发布。实施前必读：
> 仓库根 `AGENTS.md`、`docs/SPEC-0.6.0.md`（现行实现）、`docs/local.md`。
>
> **版本口径**：0.6.0 未发布（main f5c3fcf，未 push），本版在其上独立开发为 **0.6.1**（操作者
> 2026-09-28 确认不并入 0.6.0），不含任何兼容负担——`panels-update` 路由可直接删除，schema
> 可继续自由演进。

---

## 0. 执行守则

本 spec 由独立的新会话无人值守实施。SPEC-0.6.0 §0 的全部硬性约束继续有效（不碰操作者 dsh home 与实例、只按 PID 杀自己起的进程、
隔离 home 从零创建、密钥与测试信息不入 git/报告/工具输出、settings 写入必须 await、工作区外
零文件改动、commit 由执行会话完成后提交、push 由操作者执行）。

## 1. 背景与目标

v0.6.0 交付评审后，操作者对「潜在问题与优化建议」逐项决策，汇成 0.6.1：

1. **连接 tab 折叠面板重构**（最大项）：移除面板编辑功能，取消一级/二级页面跳转——面板创建后
   以折叠面板呈现，原二级页四 tab（API Keys / 模型 / 数据看板 / 使用日志）移入折叠面板内；
2. **刷新预置持久化（增量层）**：刷新结果以「与编译基线的差异」写入 namespace，重启后保留，
   settings.yaml 几乎不膨胀；
3. **看板图表增强**：费用/Token 双轴 + Top-N/「其他」合并（按 key 拆分因数据源无 key 维度否决）;
4. **删除面板 Modal 增强**：默认模型指向检测 + 覆盖条数提示；
5. **覆盖率指示可点击**（按来源过滤该面板模型列表）；
6. **工程项**：渠道去重 Set 化、账户摘要懒加载 + 缓存、IAB 输入管线根因排查、RPC envelope
   逆向 + describe 脱敏直接断言、走查/截图脚本收进 tests/。

**已评估不做**（避免重复讨论）：面板改名（删除重建替代）、共享 key、sk- key 有效性测试、
面板列表空态引导、按 key 拆分图表。

## 2. 已核实事实（2026-09-28，基于 f5c3fcf 代码）

- **连接 tab 结构**：`src/client/section.tsx` 持有 `openPanelId` 导航态；二级页在
  `src/client/panel-detail.tsx`（返回按钮 + 状态行 + 测试连接 + 四 tab）；四个 tab 组件
  （`keys.tsx` / `models-tab.tsx` / `dashboard.tsx` / `logs.tsx`）已全部面板参数化（`panel`
  prop），折叠化**不需要改动它们**。
- **编辑链路**：`panels-tab.tsx` 的 `PanelCard`（mode: create/edit）+ 宿主
  `POST /api/relay/panels-update`（`src/panels-ops.ts` `updatePanel`）。移除编辑后 create
  路径保持不变（名称/地址/用户ID/令牌四字段，名称创建后不可改的约束自然消失——因为根本没有改）。
- **删除语义**（0.6.0 现状）：`deletePanel`（`panels-ops.ts`）unset panels 条目 + 覆盖组 +
  pi-ai 路由 + 凭据引用（best-effort）。**同名重建不恢复覆盖配置与生效 key**——这是删除重建
  替代编辑的唯一隐性成本，Modal 必须披露覆盖条数。
- **`/api/relay/panels` 现状**：`panelsResponse`（`src/index.ts`）对每个已配置面板**同步
  `await relay.self()`**；面板不可达时整个列表请求阻塞至超时（20s）——懒加载改造的直接动机。
- **看板数据维度**：`/api/data/self` 返回 `{model_name, created_at, token_used, count, quota}`
  小时桶，**无 key 维度**——按 key 拆分需翻页聚合 `/api/log/self`，且面板日志保留期短于看板
  桶，否决（操作者已确认）。
- **预置层现状**：`runtimePreset`（`src/index.ts` 内存变量）重启回落编译基线
  `KNOWLEDGE_PRESET`（`src/knowledge-preset.generated.ts`，140 条）；编译基线更新靠每周
  preset-refresh workflow 的 PR 与插件发版传导。
- **渠道去重 O(n²)**：`buildPresetEntries` 里 `bare.has(stripped) || [...finalNameOf.values()].includes(stripped)`
  对 values 数组线性扫；n≈300 无感，但应顺手 Set 化。
- **IAB 输入管线失效现象**（0.6.0 走查实测）：dsh 设置对话框对 Playwright locator 点击
  （actionability 超时）、IAB `cua.click`（正确按钮中心坐标，无效果）、`dom_cua.click`、
  `keypress(Enter)` 全部无效；**仅 CDP `Runtime.evaluate` 的 DOM `.click()`（isTrusted=false）
  生效** → dsh 不校验事件可信度，问题在 IAB 输入管线本身（坐标空间或事件派发），待排查定性。
- **RPC envelope 已知线索**：`POST /api/settings/describe` 需 `type:'client-request'` +
  `rpcId` + `method:'settings/describe'`；payload 报错「must contain exactly one plain-object
  args field」——`{}` 与 `{options:{…}}` 都被拒。宿主源码在 `deepseek-harness/packages/api/
  gateway/src/stream-protocol.ts`、`index.ts` 与 `packages/api/settings-controller`，读源码定案。
- **schema 基础**：`relay` namespace（`src/index.ts` configShape）现有 `panels` /
  `capabilityCatalog` / `capabilityOverrides` 三键；`mutate` path ops 只能寻址 plain object。

## 3. R1 连接 tab 折叠面板重构

### 3.1 信息架构

- **连接 tab** = 「+ 新增中转站」按钮 + 按存储顺序的 N 个**折叠面板**（`<details>` 语义，
  复用预置区同款交互与样式基座）+ 删除确认 Modal。**手风琴：同时至多展开一个**（展开新面板
  自动收起上一个；实现为单一 `openPanelId` state，语义从「进入二级页」变为「展开哪个折叠面板」）。
- **折叠态行**：StateDot（配置齐备=done，缺项=error）+ 名称 + 元信息行（host · 账户 · 余额 ·
  模型数 · 当前 key）+ 「删除」按钮。整行（除删除按钮外）可点击切换展开。
- **展开态**：头部（状态行「已同步 N 个模型 · 当前 key X」+ 「测试连接」outline 按钮 +
  「删除」outline 按钮）+ 四个 tab（API Keys / 模型 / 数据看板 / 使用日志，现有组件原样复用，
  仅父容器从二级页变折叠面板体）。无返回按钮。
- 新增卡（原地展开，一次一张）保持现状四字段：名称 / API 地址 / 用户 ID / 访问令牌。
- **编辑功能移除**：编辑按钮、编辑卡 edit 模式、`POST /api/relay/panels-update` 路由与
  `updatePanel` 实现全部删除；「应用即写」语义只保留在 create 卡。
- 主页面顶部状态行（`panelsStatusLine`：N 个中转站 · 已同步 M 个模型）保留。

### 3.2 宿主路由变化

- **删除** `POST /api/relay/panels-update`（连同 `updatePanel`、client 侧 update 提交分支）。
- **新增** `GET /api/relay/account?panel=<id>`：返回 `{ ok, account: { username, quotaCny } }`，
  只读 `self()`；**宿主侧按面板 5s TTL 缓存**（进程内 Map，含失败结果缓存 5s，避免不可达面板
  被客户端重试风暴放大）。
- **`GET /api/relay/panels` 改为秒回**：不再调用 `self()`，响应去除 `account` 字段，保留
  配置态（host / configured / missing / tokenConfigured / userId / keyRef / selectedKeyName /
  modelCount）+ R4 新增的 `defaultModelTarget: boolean` 与 `overrideCount: number`。
- 客户端懒填充：面板行挂载时对已配置面板逐个 `GET /api/relay/account`，账户行先显示「…」，
  到达后填充；失败静默（行内只显示配置态）。测试连接动作不受缓存影响（语义就是即时探测）。

### 3.3 连接页样式修复（操作者 2026-09-28 截图指出的两项）

1. **「+ 新增中转站」按钮文字换行**：根因是 `relay_head` 右侧按钮无 nowrap（styles.ts 的
   `white-space:nowrap` 规则只覆盖 editorFooter / presetToolbar / capActions 三处按钮）。
   修复 = 把 head 区按钮并入 nowrap 规则（`.relay_head button{white-space:nowrap}` 或并入
   既有分组选择器），标题区可收缩、按钮 flex:none。
2. **新增卡 名称 / API 地址 输入框顶边不齐**：根因是 `relay_formGrid` 两列字段的标签长短悬殊
   （「名称（创建后不可修改；同时是模型提供方的名字）」折两行，其余一行），输入框起始高度随
   标签行数错开。修复 = **标签缩短为词组**（名称 / API 地址 / 用户 ID / 访问令牌；英文
   Name / Base URL / User ID / Access token），括号里的说明文字移到**输入框下方**的 hint 行
   （复用 `relay_capHint` 样式；中英 locale 各加对应 hint 键）。禁止用固定 label min-height
   之类的方案（跨语言脆弱）。
   验收：走查断言两列输入框 `getBoundingClientRect()` 顶边同值（同行），按钮单行；keys 页等
   其它 `relay_formGrid` 使用处（标签本就短）不受影响。

### 3.4 验收要点

- 展开唯一性（展开 B 自动收起 A）；刷新页面后折叠态复位（不记忆展开态——【建议】，若实现
  记忆须说明存储位置，默认不做）。
- 折叠态下删除按钮直达（无需先收起其它面板）；删除 Modal 语义见 R4。
- 四 tab 内全部既有交互回归：keys 行↔卡 / Use 竞态 / 禁用 key 警告 / 模型三计价 / 看板
  （含 R3 增强后形态）/ 日志筛选 / MenuSelect 在折叠容器内的 portal 定位。
- 能力页 caps 刷新依赖修正：`openPanelId` 语义变化后，`refreshCaps` 仍须在 namespace revision
  变化与展开切换时重拉（v0.6.0 修过的「切 key 后平台模型区显示过期未配置」不得回归）。
- 中英两遍走查 + settings.yaml 落盘断言（create/delete 路径）。

## 4. R2 刷新预置增量层（持久化）

### 4.1 数据模型

- namespace 新增可选键 `capabilityPresetDelta`：
  `{ builtAt: number, removed: string[], changed: Record<规范名, CapabilityEntry> }`。
  - `changed`：刷新结果相对编译基线**新增或修改**的条目（完整 entry）；
  - `removed`：编译基线中存在、刷新结果中消失的规范名（相对基线的删除以名字表示，schema 无需
    null 值形态）。
- **生效层解析**（`knowledge.ts` 新增 `resolvePreset(baseline, delta)`）：
  `effective = baseline − removed ∪ changed`；delta 缺省/非法时 effective = baseline。
  `resolvedKnowledge()` 与「刷新预置」即时内存层统一走该函数（内存层概念被 delta 取代：
  刷新 = 写 delta + 立即重放，**不再维护独立 runtimePreset 变量**）。
- **写入时机**：`knowledge-refresh` 成功后一次 `settings.mutate` 写入 delta（await 完再返回，
  竞态红线），随后逐面板重放（现 R2 语义不变）。models.dev 取数失败不写 delta。
- **恢复基线**：预置区新增「恢复基线」按钮（仅 delta 存在时可见）→ unset `capabilityPresetDelta`
  + 逐面板重放 + Modal 确认（文案说明回到编译基线形态）。

### 4.2 UI 与语义变化

- 预置折叠区标题/介绍处显示增量状态：「编译基线 N 条 · 已刷新（+x / −y，M-DD）」，无 delta 时
  显示「编译基线 N 条」。
- **重启语义变化**：刷新结果重启后**保留**（delta 在 settings 里，随宿主加载生效）——0.6.0 的
  「重启回落编译基线」文案全部更新（README 中英 / CHANGELOG / AGENTS / 预置区介绍文案）。
  唯一回落路径是「恢复基线」按钮或手工删 settings 字段。
- 体积护栏：delta 无上限（正确性优先），但「恢复基线」永远一键可达；README 记录该权衡。
- 编译基线仍由 `preset:fetch` 维护（每周 workflow 不变）；插件升级换新基线后，旧 delta 仍叠加
  在新基线上（语义自洽：delta 表达「用户上次刷新的意图」），预置区显示的基线条数随之变化。

### 4.3 测试

- `resolvePreset` 矩阵：无 delta / changed 覆盖同名 / removed 删除 / 两者混合 / 非法 delta；
- knowledge-refresh 处理器级：刷新后 delta 落盘断言（FakeSettings）+ 生效层立即包含新条目 +
  逐面板重放；恢复基线路由 unset 落盘 + 重放；
- deriveCapabilityFor 全链路经 resolvePreset 后的 source 标记不变（preset/preset-approximate）。

## 5. R3 看板图表增强

- **指标三态**：金额 / Token / **双轴**（现有 Pill 组扩为三个）。双轴 = 柱（金额，左轴）+
  折线（Token，右轴）；折线为逐日总额连线（跨模型合计），右轴刻度用 tokenCountText。
  `dashboard-chart.tsx` 新增折线 path 计算纯函数（`linePath(values, …)`）与右轴刻度复用
  niceScale；`<title>` 悬停沿用（折线点也带原生 title）。
- **Top-N 合并**：按窗口内总额（当前指标口径）排序，前 `TOP_N = 7` 个模型保持独立系列上色，
  其余合并为单一灰色系列「其他 N 个」（locale 键）；图例「其他」不可点击隐藏（隐藏后图表为空
  无意义）——或允许隐藏，视觉走查定。切换 7/14/30 天与指标时重排。
- 两者叠加时的层序：柱（含「其他」）在下、折线在上。
- 纯函数单测：双轴刻度、折线 path、Top-N 合并（并列额度的稳定排序）。

## 6. R4 删除面板 Modal 增强

- `GET /api/relay/panels` 每行新增：`overrideCount`（该面板覆盖组条目数）、`defaultModelTarget`
  （`agent-default-model.provider === 面板 id`，safeGet 读取，命名空间不存在时 false）。
- 删除 Modal 描述追加两行（有则显示，中英）：
  - 「该面板名下有 N 条模型能力覆盖配置，删除后将一并清除（同名重建不会恢复）。」
  - 「dsh 的默认模型当前指向该面板，删除后正在使用该面板模型的会话会立即失效，请先到 dsh
    「模型」页改选。」
- 不阻断删除（警告不拦截，操作者已确认低价值不做成硬门）。

## 7. R5 覆盖率指示可点击

- 平台模型分组头部的覆盖率指示（`capCoverage`）中，「预置 X · 知识库 Y · 覆盖 Z · 未配置 W」
  各段可点击：点击后将该面板的平台模型列表过滤为**仅该来源**的模型，再次点击同一段或点任意
  其它段切换；过滤态下该段高亮。纯客户端 state（`{panelId, source} | null`），一次只一个过滤。
- 匹配提示、徽标、编辑入口等行为在过滤态下不变。

## 8. R6 工程项

1. **渠道去重 Set 化**：`buildPresetEntries` 的 `finalNameOf.values()` 线性扫改为维护
   `strippedUsed: Set<string>`；回归 = knowledge-preset 测试全绿 + 重新跑 `preset:fetch`
   产物与现基线 diff 为空（或仅 live 漂移）。
2. **IAB 输入管线排查**（走查基建，先行）：在 dsh 对话框页面 document 层挂捕获监听
   （记录 pointerdown/click/keydown 的 clientX/Y、target、isTrusted），分别以 IAB cua 坐标
   与 CDP `Input.dispatchMouseEvent` 打同一点，定性「事件未达 / 坐标偏移 / 到达被忽略」；
   若为坐标换算问题（webview 缩放/偏移），推公式修正后继续用 IAB；否则在 AGENTS §6 把 CDP
   方案定为标准走查路径。结论与数据记 WORKLOG。
3. **RPC envelope 逆向**：读 `deepseek-harness/packages/api/gateway`（stream-protocol.ts /
   index.ts）与 `packages/api/settings-controller` 的 @Remote 序列化，确定
   `/api/settings/describe` 的正确请求形态；走查中直接从页面上下文 fetch describe，断言
   `relay` namespace 视图不含面板令牌且 `secrets` sidecar 含 `panels.<id>.accessToken` 路径
   （替代 0.6.0 的五重证据链，成为嵌套 secret 脱敏的直接集成断言）。
4. **走查/截图脚本入库**：0.6.0 会话用过的 CDP 驱动器（ws + Runtime.evaluate 直驱）与
   截图脚本整理进 `tests/walkthrough/`（或 `scripts/`，实施时定），作为长期浏览器验收工具；
   不进 npm pack files。

## 9. 测试与验收

1. **单测**（vitest，沿用隔离约定）：
   - resolvePreset 矩阵 + 刷新/恢复落盘断言（FakeSettings）；
   - panels-update 删除后的路由面审计（build-shape / 路由清单断言按需）；
   - account 路由：5s 缓存命中（同面板两次调用只打一次 mock）、失败缓存、panel 参数缺失语义；
   - 图表纯函数：双轴刻度、linePath、Top-N 合并稳定排序；
   - panels 响应形状：account 字段移除、overrideCount / defaultModelTarget 正确性；
   - 既有 192 测试全绿（受影响用例随接口变化同步更新，不降覆盖）。
2. **浏览器走查**（隔离 home + 双 mock，中英两遍）：折叠面板展开唯一性与四 tab 回归、新增卡
   （create-only）、删除 Modal 两行新警告文案、账户行懒填充（含不可达面板不阻塞列表）、连接
   测试四态、预置增量层全链路（刷新 → 落盘 → 重启实例（dsh 进程重启）后增量仍在 → 恢复基线
   → 落盘断言）、双轴与 Top-N 视觉走查、覆盖率过滤、settings.yaml 落盘断言。
3. **真实账号只读**：面板列表懒加载实测（真实面板延迟下的行内填充）、刷新预置 delta 落盘后
   的命中数复核。
4. 质量门：typecheck / vitest / build 全绿；client 体积断言（≤350KB）保持；身份哨兵审计零命中。
5. 发布前检查：bump **0.6.1**；CHANGELOG 0.6.1；README 中英（折叠 IA、增量层重启语义、图表
   三态、懒加载说明）；AGENTS §1/§2/§6/§8；WORKLOG 0.6.1（含 IAB 排查结论）；截图 6 张 ×
   中英重拍 + `screenshots.json` 核对；npm pack 审计；提交（不 push）。

## 10. 完成定义（DoD 自检单）

- [ ] 连接 tab 折叠化（手风琴单开）+ 编辑功能与 panels-update 路由移除 + 四 tab 全回归
- [ ] 连接页样式修复：head 按钮单行不折行；新增卡标签缩短 + 说明下沉 hint，两列输入框顶边对齐（rect 断言）
- [ ] /panels 秒回 + account 懒加载路由（5s 缓存）+ 行内填充
- [ ] 预置增量层：resolvePreset / 刷新写 delta / 恢复基线 / 重启保留 / 文案四处更新
- [ ] 双轴 + Top-N 图表（纯函数单测 + 视觉走查）
- [ ] 删除 Modal：覆盖条数 + 默认模型指向警告
- [ ] 覆盖率指示按来源过滤
- [ ] 渠道去重 Set 化；IAB 排查有结论并落 WORKLOG；RPC envelope 定案 + describe 脱敏直接断言；
      走查/截图脚本入库
- [ ] 中英走查两遍 + 落盘断言 + 真实账号只读
- [ ] 文档五处同步 + 截图重拍 + bump 0.6.1 + 发布前检查 + 提交（不 push）

## 11. 风险与提示

- **折叠化是本版最大 UI 变量**：四个 tab 组件本身不动（已参数化），风险集中在 section/panels-tab
  的状态提升与 caps 刷新时机；走查重点盯「展开 A → 在 A 内 Use key → 展开 B → 回到 A」链路上
  账户行 / 模型数 / 能力页数据的时效性。
- **增量层的叠加语义**：插件升级换新编译基线后旧 delta 仍叠加——通常正确（用户刷新意图优先），
  但若新基线结构性变化大，可能出现「基线说没有、delta 说有」的条目；「恢复基线」是一键出口，
  README 说明即可，不做自动失效。
- **双轴的视觉密度**：柱+线+双轴刻度在 628px 对话框宽度内可能偏挤；视觉走查不达标则降级为
  「双轴模式下隐藏网格线/缩小柱宽」再评，不达标的兜底是双轴仅在全宽（>520px 内容区）时提供。
- **IAB 排查结论可能不可修**：若根因在宿主 webview 层（我方不可控），按预案把 CDP 定为标准
  走查路径并入 AGENTS，不再阻塞后续版本。
