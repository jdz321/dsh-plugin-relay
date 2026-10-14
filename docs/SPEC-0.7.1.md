# dsh-plugin-relay → v0.7.1 开发任务书（Spec）

> **状态：已定稿（持久化方案经操作者 2026-10-14 复审修订），未实施。** 前置：v0.7.0
> （commit 6159ae0，dsh ≥0.2.1-alpha.2 entry-config 架构）已交付。实施前必读：仓库根
> `AGENTS.md`、`docs/SPEC-0.6.1.md`（现行预置增量层）、`docs/local.md`。
>
> **方案沿革**：首稿把运行时缓存持久化在 relay namespace 的 volatile 字段；操作者复审否决
> （「动态获取的内容放进配置文件不合理」），要求优先探索宿主插件数据存储能力，无则退而在
> 当前 profile 目录单独维护文件。复审**实证 dsh-base 自带面向插件的持久 KV 存储栈**
> （storage + storage-json + storage-domain，见 §2），故走宿主存储，profile 目录手写文件方案
> 不启用。
>
> **需求原文与解读**：操作者原话「去除构建阶段生成知识库逻辑，改为运行时获取，默认内天获取
> 一次，用户本地持久化」。「内天」按「每天」解读（n/m 相邻键误击）——即**默认每 24 小时自动
> 获取一次**；该间隔以单一具名常量实现，是否可配置不作为本版目标（手动「刷新预置」即是人工
> 覆盖手段）。如操作者本意是其它天数，改常量即可。

---

## 0. 执行守则

本 spec 由独立的新会话无人值守实施。SPEC-0.6.1 §0 沿用的全部硬性约束继续有效：不碰操作者
dsh home 与实例、只按 PID 杀自己起的进程（dev.js 的 dsh 子进程一并）、隔离 home 从零创建、
密钥与真实账号信息不入 git/报告/工具输出、HTTP 处理器里每个 settings 写必须 `await` 完再返回、
工作区外零文件改动、commit 由执行会话完成后提交、push 由操作者执行。models.dev 直连慢或失败
时按红线 7 带代理 env。

## 1. 背景与目标

v0.6.0 把预置知识库改成**编译期基线**：`src/knowledge-preset.generated.ts`（当前 147 条、
1752 行）由 `npm run preset:fetch`（models.dev 拉取 → 主流白名单 → 365 天窗口 → 非对话剔除 →
渠道去重）在开发机上生成并入库；基线更新靠每周 preset-refresh workflow 开 PR + 插件发版传导，
用户侧只能通过「刷新预置」把与基线的差异存为 `capabilityPresetDelta` 增量层。

这套链路的代价：基线新鲜度受发版节奏钳制（发版间隔越长，新用户拿到的能力提示越旧）；仓库里
躺一份 55KB 级生成物；weekly workflow、codegen 脚本、类型剥离 resolver 全是为它服务的基建。

**本版目标**：删掉整条构建期生成链路，预置改为**插件运行时**从 models.dev 获取同一主流口径的
结果，**在用户本地的宿主存储栈持久化**（`<DSH_HOME>/storages/relay_preset.json`，见 R1），
默认每 24h 自动刷新一次；手动「刷新预置」保留，「恢复基线」「capabilityPresetDelta 增量层」
「编译基线」概念随场景一起消亡（没有编译基线，就没有「恢复」的目标）。

**随之消亡的构建期专属能力**：OpenRouter 用量兜底（`OPENROUTER_API_KEY` 脚本侧注入，
`openrouterCanonicalNames`）。它是纯 codegen 侧的补数手段，运行时刷新按既有口径**不引入新
凭据**，故一并移除；主流口径回归纯 models.dev 第一方白名单。预置条目构成可能较 0.7.0 基线
略有出入（仅兜底条目消失），属预期。

## 2. 已核实事实（2026-10-14，基于 6159ae0 代码与安装树 node_modules 实测）

- **`KNOWLEDGE_PRESET` 引用面**：仅 `src/index.ts` 四处（import、`effectivePreset()`、
  `baselineCount`、knowledge-refresh 的 `baseline` 入参）。删除爆炸半径小。
- **增量层引用面**：schema `capabilityPresetDelta`（index.ts:104）、`storedPresetDelta()`/
  `effectivePreset()`（index.ts:174-187）、`capabilitiesView()` 的 `baselineCount`+
  `presetDelta`（index.ts:373-382）、`refresh.ts` 全文、`store.ts` get() 合成对象一行、
  `types.ts` 的 `RelayConfigCells` 一行、client `capabilities.tsx` 状态行（382-397 行）与
  locale `capPreset*` 键、tests 三处（knowledge.test.ts §304 矩阵、refresh.test.ts 全文、
  build-shape config keys 断言）。
- **buildPresetEntries 管线是纯函数**（`knowledge-preset.ts`）：白名单（`PRESET_PROVIDERS`
  16 键）→ 365 天窗口（`PRESET_MAX_AGE_DAYS`，仅第一方条目日期权威）→ 非对话双信号 →
  渠道去重（Set 化）。OpenRouter 兜底是它的可选入参 `options.openrouterNames` +
  `openrouterCanonicalNames`，只有脚本在传。**管线本身原样保留**，仅摘除兜底入参与兜底函数。
- **运行时取数基建现成**：`ModelsDevClient`（`capabilities.ts`）已带进程内缓存、单飞、
  `refresh()` 强制刷新（单飞、失败抛错且不动旧缓存）、代理 env（`envProxy()`）与测试
  `fetchDoc` seam。「刷新预置」路由已经在用它（index.ts:602）。
- **宿主存储栈（本版持久化真源；安装树 0.2.1-alpha.2 实测与 submodule 源码
  `dsh-v0.2.1-alpha.2` 双向核对一致，读源码两处皆可）**：
  - `dsh-base` 的 bundle patch（`node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`
    170-184 行）挂了三个行：`storage`（hub，service key `storage`）、`storage-json`
    （backend 名 `json`，**唯一配置 `root: !!js dshHomePath('storages')`，即
    `<DSH_HOME>/storages/`**）、`storage-domain`（domain 表单，`config: {backend: json}`，
    把 domain 路由到 json 后端）。dsh-base patch 是「每个 base-backed profile 的共享核心」，
    dsh web 的 base-backed profile 一律携带；同 patch 内的 `session-projection-cache` 就是
    它的现成消费者（web 会话列表投影列）。
  - **json 后端落盘语义**（`@deepseek-ai/dsh-storage-json` README + lib）：root 按需创建、
    权限 `0o700`；`single` 布局每个 unit 一个完整 `<unit>.json` 文件；写路径 = 临时文件 +
    fsync + 原子 `rename()` + POSIX 父目录 fsync，「解析返回即持久」；medium 解析失败拒绝
    `malformed-medium`；unit 版本戳不匹配拒绝 `version-mismatch`（`single` 布局读取是
    严格版本匹配）。
  - **hub 契约**（`@deepseek-ai/dsh-storage` lib/types）：`Storage.backend` 是
    `BackendRegistry`（`get(name)` 解析后端）；**`UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`**
    （unit 名同时是文件名段）；`storageBackendServiceKey('json') === 'storage.backend.json'`
    （后端插件发布的生命周期 service key，供消费者 inject 以避免与后端注册竞速）。
    `KvFacet.open(KvUnitDescriptor)` → `KvUnit`：`loadAll()` / `putRecord` / `deleteRecord` /
    `setGlobal(value)` / `close()`；**值是不透明 JSON，该层无 schema**；descriptor 携带
    `{name, version, tables, hasGlobal, layout}`；同一 unit 名重复 open 拒绝；close 后一切
    调用拒绝 `closed`；**unit 不串行化并发写，顺序由调用方负责**。
  - **第三方插件消费先例**：`dsh-workspace/lib/index.js` `static inject = ['storageDomain',
    'sessionPersistence']` + `await ctx.storageDomain.open(spec)`。domain 表单需要 zod schema
    （`dsh-storage-domain` 依赖 `zod ^4.4.3`）。**本插件不采用 domain 表单**（避免为一份
    缓存引入 zod 运行时依赖），走 hub 的裸 `KvFacet`——值不透明正合适，归一化由插件自己的
    `normalizePresetCache` 承担（与现 `normalizePresetDelta` 同款）。
  - **`@deepseek-ai/dsh-storage` 包零 dependencies**（仅 peer `@deepseek-ai/cordis`），
    以 peerDependency + devDependency（精确锁 0.2.1-alpha.2，与 `engines.dsh` 同班次）引入
    不破坏「运行时零 dependencies」纪律；tsdown 侧加入 `HOST_EXTERNALS`（neverBundle），
    运行时由宿主模块表供给，与 schemastery 同款。
- **生效层读取必须是同步的**：`resolvedKnowledge()` / `effectivePreset()` 被路由处理器同步
  调用；存储是异步的 → 插件持有**内存层**（模块级变量），启动时异步水合、每次成功获取后
  更新；同步读取只碰内存层。
- **codegen 基建清单**（全删）：`scripts/fetch-knowledge-preset.mjs`（依赖
  `--import scripts/ts-resolver.mjs` 类型剥离，需 Node ≥22.18）、package.json `preset:fetch`
  script、`.github/workflows/preset-refresh.yml`（每周一 02:23 UTC 开 PR）。`ci.yml` 不跑
  `preset:fetch`，无需改动；`publish.yml` 不涉及。`scripts/dev.js`/`dev.d.ts` 与 codegen 无关，
  保留。
- **插件定时器**：HostContext 封装类型（`src/types.ts`）目前只声明了 effect/on/inject 等；
  cordis 标准 ctx 有 fiber 生命周期的 `setInterval`，**宿主 0.2.x 是否透传未实证**——实施时
  先验证 `ctx.setInterval`，不可用则用 `ctx.effect(() => { const t = setInterval(...); return
  () => clearInterval(t) })` 自管（effect 返回的清理函数随 fiber 卸载执行）。

## 3. R1 数据模型与持久化（宿主 storage 栈）

### 3.1 缓存形状与落盘位置

- 缓存值：`{ fetchedAt: number, entries: Record<规范名, PresetEntry> }`（`PresetEntry` 形状
  不变，即 `buildPresetEntries().entries`）。不含任何密钥类数据。
- **落盘**：宿主 json 后端，unit `relay_preset`（满足 `UNIT_NAME_RE`），descriptor
  `{ name: 'relay_preset', version: 1, tables: [], hasGlobal: true, layout: 'single' }`，
  缓存整体写 **global 槽**。介质文件 = `<DSH_HOME>/storages/relay_preset.json`，由 json 后端
  原子发布（临时文件 + fsync + rename）。**version 固定 1 且不随版本升级翻动**：`single`
  布局严格版本匹配，`version-mismatch` 按降级处理（§3.4），不做自动迁移。
- **不做的事**：不写任何 settings/entry config 字段（`capabilityPresetCache` 字段不引入，
  schema 四顶层字段变三：`panels` / `capabilityCatalog` / `capabilityOverrides`）；不碰
  `profiles/<name>/` 目录（那是配置文档的地盘）；不直接 fs 写 `<home>/storages/`（介质归
  后端所有）。

### 3.2 插件侧封装（可测 seam）

- 新模块（如 `src/preset-store.ts`）定义 seam：

  ```ts
  interface PresetCacheStore {
    /** 水合：缓存缺失/非法/version-mismatch/存储栈缺失 → null（内部已容错）。 */
    load(): Promise<PresetCache | null>
    /** 持久化；任何失败抛错，由调用方 warn 后继续（内存层不受影响）。 */
    save(cache: PresetCache): Promise<void>
    /** 随 fiber 卸载关闭 unit（幂等）。 */
    close(): Promise<void>
  }
  ```

  生产实现包装 `KvUnit`（open 一次、句柄复用——重复 open 拒绝）；测试实现 = FakeSettings 同
  级的 fake `KvUnit`（内存 Map + 可注入 open/save 失败）。
- `normalizePresetCache(raw)`：非对象 / 缺 `entries` / 非法 `fetchedAt` / `entries` 非普通
  对象 → 视为「无缓存」（schemastery dict 壳问题不复存在，但容错照旧）。
- **内存层**：`refresh.ts`（或其更名模块）持有模块级 `let presetCache: PresetCache | null`。
  `effectivePreset() = normalizePresetCache(presetCache)?.entries ?? {}`（同步、纯读）。
  启动水合与获取成功都是对该变量的整体赋值。启动到水合完成的短暂窗口内预置层为空，属预期
  （能力页显示「尚未获取」，首次获取成功后重放会立刻把路由补齐）。
- **删除**：`KNOWLEDGE_PRESET` 与 `knowledge-preset.generated.ts`、`resolvePreset` /
  `diffPreset` / `normalizePresetDelta` / `summarizePresetDelta` / `PresetDeltaSchema` /
  `RelayConfigCells.capabilityPresetDelta`（连带 store.ts 合成对象与 types.ts 字段）；
  `knowledge-preset.ts` 头注释改写为「运行时与测试共用的主流口径构建管线」。`resolvedKnowledge()`、
  `knowledgeForPanel`、L0-L5 匹配、`PRESET_ALIASES`、用户知识库与覆盖层一律不动。

### 3.3 装配（index.ts apply）

- 新增 `ctx.inject(['storage', 'storage.backend.json'], …)`（第二键 =
  `storageBackendServiceKey('json')`，生命周期键保证后端已注册；两键解析后才回调）。回调里
  open unit、构造生产 `PresetCacheStore`、执行启动水合，然后触发启动到期检查（§4）。
  **服务不可用（非 base-backed profile、未来宿主变更）时该 inject 永不触发**——即天然降级，
  另在 settings inject 回调里若超时未见存储就绪则 `logger.info` 一条「预置缓存不可用，仅
  内存层」。
- unit 的 `close()` 挂 effect 清理函数，随 fiber 卸载执行。

### 3.4 降级矩阵（全部不阻塞路由、不抛给客户端）

| 情形 | 行为 |
|---|---|
| 存储栈缺失（inject 永不就绪） | 纯内存层，获取照常，重启丢失；启动后 info 一条 |
| `kv.open` 拒绝（`malformed-medium` / `version-mismatch`） | warn 一条（含介质路径与「可手工删除该文件重置」），本轮内存层照常；下一获取周期重试 open |
| `save` 抛错 | warn，内存层已更新，下周期重试 |
| 介质被操作者手工删除 | 下次 open 视为空 unit（后端按缺失物化），正常重建 |

## 4. R2 获取时机：每天一次 + 手动强制

- **间隔常量**：`PRESET_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000`（具名导出，单一出处）。
- **触发面**（三者并存，获取本身单飞合并）：
  1. **启动检查**：settings（store）与 storage 两边就绪后调度一次后台检查——缓存缺失或
     `now - fetchedAt ≥ INTERVAL` 即触发获取。**绝不阻塞 apply、绝不阻塞任何路由注册**。
  2. **运行中定时器**：fiber 生命周期内的周期检查（建议 1h 粒度；`ctx.setInterval` 可用性
     未实证，按 §2 末条验证/降级）——dsh 长驻不重启时也能每天翻新。到期判定抽纯函数
     `isCacheStale(fetchedAt, now)` 便于单测。
  3. **手动「刷新预置」**：`POST /api/relay/knowledge-refresh` 保留，绕过到期判定强制获取。
- **单飞**：`ModelsDevClient.refresh()` 已单飞；外层再加一个模块级「刷新进行中」守卫，
  使定时器/启动/手动的并发触发至多产生一次「取数 → 写缓存 → 重放」链（也满足 KvUnit
  「并发写不串行化，顺序调用方负责」的契约——同一时刻至多一条链）。
- **成功路径**：`fetchDoc → buildPresetEntries（无 openrouter 入参）→ 更新内存层 →
  await store.save({fetchedAt, entries}) → 逐面板重放`（沿用现 refresh 语义：重放失败可读地
  报告，**不回滚**已写缓存；无已配置面板时跳过重放）。
- **免重放优化**：本次 `entries` 与内存层原值深相等时仍 `save`（`fetchedAt` 要翻新以兑现
  「每天一次」），但**跳过重放**（内容没变，重放是纯浪费的 llm-pi-ai 修订写）。
- **失败路径**：内存层原样保留；`logger.warn`；失败态进入 `presetMeta.lastError`（R3）供
  状态行展示；下个定时器到期 tick 自然重试（不引入指数退避——1h 检查粒度即是重试节奏）。
- `effectivePreset()` 保持同步纯读，绝不联网、绝不 await。

## 5. R3 接口、客户端与升级语义

### 5.1 路由变化

- `POST /api/relay/knowledge-refresh`：响应改为 `{ok, count, fetchedAt, replayed,
  replayError?}`（delta 字段删除；`count` = 本次条目数）。失败（取数）仍 502 + 可读错误。
- `POST /api/relay/preset-restore` **删除**（连同 `restorePresetBaseline`）。
- `GET /api/relay/capabilities`：`baselineCount` 与 `presetDelta` 删除，新增
  `presetMeta: { count, fetchedAt?, lastError? }`（fetchedAt 来自内存层；lastError 为最近一次
  后台或手动获取失败摘要，成功后清空；存储不可用不是 lastError——它有自己的降级日志）；`presets`
  字段照旧返回生效条目。
- 路由清单审计（build-shape / 走查）同步更新。

### 5.2 客户端（capabilities 页）

- 预置折叠区**状态行**改三态（中英 locale 同步）：
  - 有缓存：「本地缓存 N 条 · 更新于 M-DD」（`fetchedAt` 格式化沿用 `monthDay`）；
  - 无缓存：空态文案（如「尚未获取——联网后自动获取，或点「刷新预置」立即拉取」），条目区
    显示占位提示而非空列表；
  - 有缓存但 `lastError` 存在：状态行附加「上次更新失败（M-DD · 原因摘要），将自动重试」。
- **「恢复基线」按钮、确认 Modal、`capPresetRestore*` locale 键全删**；「刷新预置」按钮保留
  （文案不变）。刷新中 loading 态沿用。
- 预置区**介绍文案改写**（`capPresetIntro`，中英）：从「随插件编译…增量…恢复基线」改为
  「从 models.dev 联网获取的主流模型基线，默认每天自动更新一次，结果保存在 dsh 的本地存储
  （`storages/relay_preset.json`）；「刷新预置」可立即更新」。README 中英同步（预置章节重写：
  不再随插件内置基线；**首次使用需联网获取一次**；离线新装用户在获取成功前无预置提示，知识库/
  覆盖配置不受影响；缓存文件在 `<DSH_HOME>/storages/`，删除即重置）。

### 5.3 升级语义（≤0.7.0 的 home）

- 旧 home 的 profile patch 里残留 `capabilityPresetDelta`：新 schema 不再声明该字段，宿主
  只投影声明过的 volatile 字段，残留键应表现为**惰性存在**（不报错、不投影、不可写）。0.2.x
  只允许写 volatile 声明过的路径，插件**无法**替用户程序化清掉它——不做清理，README 一句话
  说明「旧字段为惰性残留，可无视；介意者手工编辑 profile patch 删除」。
- 旧「刷新结果」不迁移：0.7.1 首次成功获取后由新鲜数据整体取代；获取前的空窗期预置层为空
  （§5.2 空态文案覆盖）。
- **实施时必须验证**惰性表现：用 0.7.0 隔离 home（或对现成隔离 home 手工植入 delta 键的
  patch）装 0.7.1 产物启动，断言无加载错误、describe 不投影、页面正常、首次获取后预置区
  正常。结论入 WORKLOG。

## 6. R4 文档与工程清理

1. **删除**：`src/knowledge-preset.generated.ts`、`scripts/fetch-knowledge-preset.mjs`、
   `scripts/ts-resolver.mjs`、`.github/workflows/preset-refresh.yml`、package.json
   `preset:fetch`。
2. **新增依赖声明**：`@deepseek-ai/dsh-storage` 进 `peerDependencies` 与 `devDependencies`
   （精确 `0.2.1-alpha.2`，与 engines.dsh 下限同班次——升级宿主开发依赖时锁步升级，纪律同
   `@deepseek-ai/dsh-client-ui-primitives`）；`tsdown.config.ts` 的 `HOST_EXTERNALS` 增加
   `@deepseek-ai/dsh-storage`；build-shape 的宿主 ESM externals 断言同步。**运行时零
   dependencies 保持不变**。
3. `AGENTS.md` 同步：§1 预置层段落改写（运行时获取 + 宿主存储持久化 + 每日一次；删「编译期
   基线/preset:fetch/增量层/恢复基线」表述，补 storage 栈一段——unit 契约、落盘位置、降级
   矩阵）；§2 结构图删三个文件、补 `preset-store`；§3 命令表删 `preset:fetch`；§4 或 §5 补
   一节「dsh 存储栈集成语义」（`ctx.inject(['storage','storage.backend.json'])`、
   `UNIT_NAME_RE`、version 不回迁、并发写自行串行）；§6 走查清单预置项改写；§8 追加 v0.7.1。
4. `docs/WORKLOG.md` v0.7.1（含 `ctx.setInterval` 验证结论、storage 栈实证过程、旧字段惰性
   验证结论、首取条目数与 0.7.0 基线差异）。
5. `CHANGELOG.md` 0.7.1；README 中英；`screenshots.json` 核对——能力页截图（中英 2 张）
   因状态行/介绍文案变化需重拍（沿用 0.7.0 截图配方：暗色、居中、裁掉 Components 段）。
6. bump **0.7.1**。

## 7. 测试与验收

1. **单测**（vitest，全部经 seam 注入，不起真宿主）：
   - `normalizePresetCache` 矩阵：undefined / 非对象 / 缺 entries / 非法 fetchedAt / 合法；
   - `isCacheStale` 纯函数（边界：`now - fetchedAt` 恰好等于间隔即算过期，与 §4 定义一致）；
   - fake `PresetCacheStore`（内存 + 可注入失败）下的刷新链（处理器级）：首取落盘断言 +
     内存层立即可见 + 逐面板重放；entries 未变 → save 翻新 fetchedAt 但**不重放**；取数失败 →
     内存层原样 + lastError + 不 save；save 抛错 → 内存层已新、warn、响应仍 ok；重放失败不
     回滚；并发触发只一条链（单飞守卫）；
   - fake `KvUnit` 下的生产 store：load 把缺失/`version-mismatch`/`malformed-medium` 归一为
     null；save 透传写 `setGlobal`；close 幂等；
   - knowledge-refresh 响应形状（count/fetchedAt/replayed，无 delta）；
   - capabilities GET 元数据（presetMeta 三态）；
   - **删除**：resolvePreset/diffPreset/normalizePresetDelta/summarizePresetDelta 矩阵、
     preset-restore 用例、`openrouterCanonicalNames` 与 knowledge-preset 的 openrouter fixture
     用例；**保留**：buildPresetEntries 白名单/窗口/非对话/去重 fixture 矩阵（去掉 openrouter
     维度）、knowledge L0-L5 全矩阵、其余 210 项不降覆盖；
   - build-shape：config keys 断言改 `['capabilityCatalog','capabilityOverrides','panels']`
     （三顶层字段）；宿主 ESM externals 断言含 `@deepseek-ai/dsh-storage`；client ≤350KB 与
     哨兵审计不变。
2. **浏览器走查**（隔离 home + mock 面板，中英两遍）：能力页预置区三态状态行与空态、刷新预置
   （成功/失败两路：断网或坏 URL 模拟）、`<隔离home>/storages/relay_preset.json` 落盘断言
   （含 fetchedAt+entries、无任何 settings 写）、**dsh 进程重启后缓存仍在且 24h 内不重取**
   （以 fetchedAt 不变 + 日志佐证）、删除该文件后重启能重建、四 tab 与能力页其余项回归、
   旧 delta 残留 home 的惰性验证（§5.3）。
3. **真实账号只读**：真实面板下刷新一次，复核条目数与匹配徽标分布较 0.7.0（147 条基线 /
   67-of-83 实证）的变化并记 WORKLOG（OpenRouter 兜底移除后的条目构成差异属预期）。
4. **质量门**：typecheck / vitest / build 全绿；`git status` 无杂物；删除文件不残留引用
   （全库 grep `preset:fetch|knowledge-preset.generated|capabilityPresetDelta|preset-restore`
   仅允许命中 CHANGELOG/WORKLOG/SPEC 历史段落）。
5. 发布前检查：bump 0.7.1、CHANGELOG、README 中英、截图重拍、npm pack 审计（files 清单不含
   src/、scripts/，无新文件泄漏）、提交（不 push；push 与 tag 发布由操作者执行）。

## 8. 完成定义（DoD 自检单）

- [ ] `knowledge-preset.generated.ts` / `preset:fetch` 链路 / weekly workflow / OpenRouter
      兜底 全部移除，全库无死引用
- [ ] storage 栈集成：`ctx.inject(['storage','storage.backend.json'])` + `relay_preset` unit
      + `PresetCacheStore` seam + 内存层同步读 + 降级矩阵全路径
- [ ] config schema 回到三顶层字段，delta 层全删，`capabilityPresetDelta` 惰性验证通过
- [ ] 启动检查 + 定时器 + 手动刷新三触发面，单飞，失败保留内存层并报 lastError
- [ ] knowledge-refresh 新响应 / preset-restore 删除 / capabilities presetMeta
- [ ] 客户端三态状态行 + 空态 + 介绍与 README 文案（中英）
- [ ] 重启保留 + 24h 免重取 + 介质删除重建 三条走查断言通过
- [ ] 单测增删按 §7（总量不降覆盖）；typecheck/vitest/build 全绿；零 dependencies 保持
- [ ] 中英走查两遍 + storages 落盘断言 + 真实账号只读复核
- [ ] 文档同步（AGENTS/README×2/CHANGELOG/WORKLOG）+ 能力页截图重拍 + bump 0.7.1 + 提交

## 9. 风险与提示

- **首次使用体验**：删掉编译基线后，离线新装用户在首次获取成功前预置层为空（能力页无预置
  提示、匹配徽标全「无匹配」）；知识库/覆盖/连接/模型同步等一切其它功能不受影响。文案必须把
  这个状态说清（空态行已覆盖）。这是本方案的结构性取舍，不是缺陷。
- **无代理环境**：models.dev 直连慢/失败是既定环境事实（红线 7）。后台获取失败不重试风暴
  （1h 节奏 + 单飞），状态行给 lastError；操作者环境按红线配代理即可。
- **storage 栈是宿主行为而非插件私有**：`<home>/storages/` 由 dsh-base 挂载、session 投影
  缓存与 workspace 共用同一后端。插件只遵守公开契约（inject service key / KvFacet /
  UNIT_NAME_RE），不假设 root 路径（由后端配置决定，当前为 `dshHomePath('storages')`）。
  若未来宿主改挂 sqlite 后端，`storage.backend.json` 生命周期键不再就绪 → 插件走「存储栈
  缺失」降级（内存层），不崩。
- **`version-mismatch` 无自动恢复**：`single` 布局严格版本匹配且后端无删除 API——本版约定
  version 恒为 1 不翻动；万一命中（如介质被外力改写），warn + 提示手工删除
  `storages/relay_preset.json`，下轮 open 视作空 unit 自愈。
- **多进程共写**：多个 dsh 实例共用同一 home 时，json 后端 `single` 布局是 last-writer-wins
  （无锁）。两进程获取的是同一份 models.dev 数据，互踩无害；README 不必展开，WORKLOG 记一句。
- **models.dev 形状漂移**：取数/构建已在 try/catch 内，坏文档抛错走失败路径不动旧缓存；与
  0.6.0 以来的行为一致。
- **`ctx.setInterval` 未实证**：宿主若未透传，降级方案（effect + setTimeout/setInterval
  自管清理）已在 §2 备好；验证结论入 WORKLOG。
- **兜底移除的条目构成变化**：真实账号复核时若发现个别常用模型跌出预置（此前靠 OpenRouter
  兜底进入），属预期行为；如操作者后续要求恢复兜底，需另立决策（运行时引入凭据是红线级议题）。
