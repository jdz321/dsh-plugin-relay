# dsh-plugin-relay → v0.5.1 开发任务书（Spec）

> **状态：未实施。** 调研已完成（2026-09-25），§2 的组件与交互事实均来自 **dsh 源码 submodule（`deepseek-harness/`，钉在 `dsh-v0.1.5-rc.2`，与安装的 `@deepseek-ai/dsh@0.1.5-rc.2` 同版本）** 的直接阅读，可直接引用。实施前必读：仓库根 `AGENTS.md`、`docs/SPEC-0.5.0.md`（v0.5.0 已交付的现状与语义）、`docs/local.md`。
> **执行者**：接手本任务的 AI 编码会话（可无人值守自主完成开发、测试、验收、文档）。

---

## 0. 执行守则

1. SPEC-0.5.0 §0 的全部硬性约束继续有效（不碰操作者 dsh home 与实例、只按 PID 杀自己起的进程、隔离 home 从零创建、密钥与测试信息不入 git/报告/工具输出、settings 写入必须 await、工作区外零文件改动）。
2. `deepseek-harness/` 是**只读参考**：调研、对照交互、核对组件 props 都以它为准；**禁止修改、禁止 import 其源码进产物**（类型声明按 §2.2 的 `.d.ts` 方案自写）。submodule 已由任务书阶段建立，实施时如缺失按 §2.1 命令恢复。
3. 【要求】是验收契约；【建议】是基线，可自主偏离并在报告说明理由。正确性 > 便捷性；不确定的事实读 submodule 源码求证。

---

## 1. 背景与目标

v0.5.0 交付六页签后，操作者反馈五项体验调整：

| # | 需求 | 结果描述 |
|---|------|----------|
| R1 | API key 原地编辑 | 「编辑」在当前 key 行内展开编辑卡（对齐 dsh 自带 Models 设置页的行↔卡交互），不再弹独立表单块 |
| R2 | 复用 dsh 原生组件 | 选择器改用 primitives `Menu`（对齐官方 LanguageRow 先例的 MenuSelect 形态）；Switch、chip、徽标、开关、确认框等改用 primitives；确立宿主版本兼容策略（§4.1） |
| R3 | 看板四卡一行 | 「当前可用余额 / 今日消耗 / 累计消耗 / 累计请求数」固定一行 |
| R4 | 日志筛选修复 | 结束时间输入与「模型名称」选择器叠压；顺带修复三个下拉占位文案都显示「选择分组…」的错误 |
| R5 | 能力页重构 | 知识库预置（编译期从 models.dev 拉主流模型进代码）+ 统一刷新按钮（去掉逐行 ↻）；上下文窗口支持 `1M`/`256K` 写法；平台模型卡默认收起、编辑才展开；每张卡「完成」即保存，删除右上角全局保存按钮 |

版本号 `0.5.1`（纯体验修订，无数据格式变更；`relay` namespace schema 仅**新增**可选键）。

---

## 2. 已核实事实（dsh 源码 + 现状代码，2026-09-25）

### 2.1 submodule 恢复命令（实施时若缺失）

```sh
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890   # 直连慢时
git submodule update --init --depth 1
cd deepseek-harness && git fetch --depth 1 origin tag dsh-v0.1.5-rc.2 && git checkout dsh-v0.1.5-rc.2
```

### 2.2 `@deepseek-ai/dsh-client-ui-primitives`（`packages/client/ui-primitives`）

- **定位**：dsh 官方明确它是「控件唯一可以共享的地方」，插件可用；零 cordis、零依赖（package.json `dependencies: none`），样式全部走 `--dsw-*` token——正是插件复用的设计边界。它在外壳冻结模块表 `PLATFORM_MODULES` 里（实测键：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`dsh-client-ui-slots`、**`dsh-client-ui-primitives`**、`dsh-client-ui-dockkit`），因此插件 bundle 运行时 `require("@deepseek-ai/dsh-client-ui-primitives")` 可解析，**无需 `dsh.client.external` 声明**（基座之内的请求不用声明，react 先例）。
- **导出面（`src/index.ts`）**：`Button`、`Switch`、`Input`、`Menu`、`Pill`、`Tag`、`StateDot`、`DisclosureRow`、`Modal`、`RiskConfirmation`、`Tooltip`、`HoverCard`、`Toast`、`ConnectionIndicator`、图标（`IconChevronDownOutline14` 等）与各类输出渲染器。**没有名为 `Select` 的组件、没有通用 `Card`**——下拉选择用 `Menu` 组合（见上）；卡片与字段块是功能包自写组件 + CSS module（`ui-settings-plugins` 的 `PluginCard`/`fields.tsx` 是记录在案的先例）。
- **选择器 = `Menu`（官方先例：`packages/client/locale/src/client/LanguageRow.tsx`，即设置页语言下拉）**：anchor 按钮（当前值 + `IconChevronDownOutline14`，`aria-haspopup="menu"`）+ `<Menu open onClose items selectedId onSelect align portal />`，portal 模式渲染进 body、随滚动重定位。这就是 dsh 的「select 惯用法」，本插件的下拉一律走它（§4）。
- **关键 props（源码核实）**：
  - `Button`：`variant: 'primary'|'ghost'|'outline'|'toolbar'`（默认 ghost）、`size: 'md'|'sm'`、`icon?`，透传 button 属性。
  - `Switch`：**受控**，`{ checked, onChange(next), label(必填!), disabled?, title?, className? }`。
  - `Pill`：`{ active?, onClick?, children, className? }`——无 onClick 渲染为静态 span；用于视图切换/筛选胶囊。
  - `Tag`：`{ tone?: 'outline'|'solid'|'neutral'|'quiet'|'success'|'info'|'warning'|'danger' }`，11px 只读徽章。
  - `StateDot`：`done|warning|ongoing|error|idle` 五态，`aria-hidden`。
  - `DisclosureRow`：24px 紧凑折叠行（标题+内容左右排列），`{ icon, title, open, expandable, onToggle, expandOnRowClick, collapsedContent, children, … }`。**不适合**做「名称叠描述」的卡片折叠——那是功能包自己的卡片布局（README 明示 PluginCard 先例）。
  - `Modal`：`{ open, onClose, title, closeLabel(非 headless 必填), description?, children?, footer?, contentClassName?, headless? }`，body portal + Escape/遮罩关闭。
- **类型**：该包未随 npm 安装（node_modules 无此包）。按仓库既有惯例（`src/types.ts` 自写宿主接口），在 `src/types/` 新增**手写最小 `.d.ts`**（只声明用到的组件面，props 以上述源码为准）；构建侧把包名加入 `tsdown.config.ts` 的 `CLIENT_EXTERNALS`（rolldown 对 external 不解析、CJS 产物原样保留 `require`——实施时验证，见 §11 风险）。

### 2.3 官方 Models 设置页交互（`packages/client/ui-settings-models/src/client`，R1/R2 的参照基准）

- **行 ↔ 卡**：每提供方一行（`rowHead`：名称 + Tag + 凭据状态点 + 编辑/删除）；点「编辑」**该行原地展开为编辑卡**；`editing` 是单一状态（`editing?.provider === row.provider` 决定 open）——**全页同时只有一张展开卡**，每张卡各自持有草稿，关一张不丢另一张。
- **每卡独立提交**：`EditorFooter` = 左「取消」（secondary）+ 右「应用」（primary，busy 文案切换）；Apply 即刻写 settings（带 revision 守卫），成功后收卡并刷新；失败**卡保持展开**并显示 Host 诊断。
- **保存通告**：`<p role="status" aria-live="polite">` 段落（`savedNotice`），不用 alert。
- **折叠区**：编辑卡内「自定义设置」用**原生 `<details><summary>`**。
- **下拉**：Models 页编辑卡内是**原生 `<select>`** + 样式类（`input selectInput`）；而 General 设置的语言选择器（`locale/LanguageRow.tsx`）是 **`Menu` 组合选择器**——两种官方惯用法并存，本插件统一取后者（§4 映射表）。
- **删除确认**：**`Modal`**（primitives）承载「指名对象的确认对话框」，非两段式按钮。
- 参照结论：我们的设置区继续保持自绘 slot 区 + 单一样式表方案不变（不改 CSS module 构建），但**控件尽量换成 primitives、布局词汇（行卡/字段块/页脚）照抄 Models 页形态**。

### 2.4 现状代码缺陷定位（R3/R4）

- **看板换行**：`src/client/styles.ts` `.relay_dashCards{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}`——设置对话框内容区实测约 690px，四卡需 `4×150+3×10=630px` 尚可容纳，但卡片内边距与 18px 数值字号使实际下限超出，auto-fit 退化为 3+1。修复：固定 `repeat(4,minmax(0,1fr))` + 压缩数值字号（18→16px）与卡片内边距。
- **日志叠压**：`.relay_filters` 里时间范围字段（`filterFieldWide`，flex `2 1 240px`）内部是 `.relay_row`（**不换行**）装两个 `datetime-local` 输入（浏览器固有宽度各约 150–180px）——总宽超出字段盒且无 `min-width:0`/换行，结束时间溢出叠到相邻「模型名称」select 之下（截图实证）。顺带缺陷：三个下拉的空选项共用 `keyGroupEmptyOption`（「选择分组…」），模型/密钥下拉文案错误。
- **日志表格**（顺带记录，不在本次验收范围强制项）：760px 下 8 列拥挤（「default」换行、「¥0.019328」折行）；R4 允许顺带微调列宽与字号，但不改列结构。

### 2.5 知识库预置的数据源事实（R5）

- models.dev `api.json`：223 provider，条目含 `modalities.input / reasoning / reasoning_options / limit.context`；同名校并集逻辑已存在（`src/capabilities.ts` 的 `mapModelsDevEntry`/`mergeSuggestions`，含 contextWindow 取最大）。
- **面板的「全部支持模型」接口 = `GET /api/pricing`（公开、免鉴权）**：2026-09-25 实测与 `GET /api/user/models`（需管理鉴权）**完全一致**（82 = 82，双向零差集）——预置脚本只需要面板 baseUrl，不碰任何凭据。`src/pricing.ts` 的 `normalizePricing` 已把条目整形为 `byModel`（键即 model_name），脚本可直接复用。
- v0.5.0 实测：82 个面板 id 对全量 models.dev 命中 79（75 精确 + 4 近似）→「面板模型列表（规范化后）∪ 主流 provider 白名单」的预置规模足以覆盖。
- 规模估算：主流 provider（openai/anthropic/google/deepseek/alibaba/qwen/moonshot/xai/mistral/zai 等 ~15–20 家）按名并集约 300–600 条；每条 ~60B，宿主产物增 30–60KB（现 72KB），可接受。

### 2.6 dsh 插件 ↔ 宿主版本兼容（实证 2026-09-25）

- **npm 发布线**：`@deepseek-ai/dsh` npm 最新为 **0.1.5-rc.3**（git 仓库已有 `dsh-v0.1.6-*`/`dsh-v0.1.7-*` tag 但未发 npm）。本插件 devDependency 与 `engines.dsh` 均基于 0.1.5-rc.2，安装面即 npm 线。
- **机制本质**：primitives 等 `@deepseek-ai/dsh-client-ui-*` 运行时不经 npm——**宿主把「自己那版」编译产物通过冻结模块表供给插件**。因此 npm 侧 peer/engines 无法表达「primitives API ≥ X」这类约束；兼容性 = ① `engines.dsh` 下限钉在「模块表已含所需键」的首个宿主（0.1.5-rc.2 实测含全部所需键）+ ② 插件侧只消费**跨版本稳定子集**并在升级宿主后做浏览器冒烟。
- **跨 tag API 漂移实测**（`git diff dsh-v0.1.5-rc.2 dsh-v0.1.7-rc.1`，仅看本插件消费面）：`Switch`/`Pill`/`Tag`/`Button` **零改动**；`Menu` +269 行纯增量（新增 `MenuItemButton`，本插件用的 open/anchor/items/selectedId/onSelect/onClose/align/portal 全部保留）；`Modal` 纯增量（新增可选 `onKeyDownCapture`）；`StateDot` 的 `{ state: 'done'|'warning'|'ongoing'|'error'|'idle', size, className }` 在两版一致。→ 本插件消费的子集跨 0.1.5→0.1.7 **向后兼容**。
- **0.1.7 的机会面（暂不用）**：primitives 新增 `settings-form/`（fields/form-model，官方正在把设置表单下沉为共享套件）与 `SegmentedControl`/`SegmentedTabs`/`Checkbox` 等——等 npm 宿主线跟上后再评估采用。
- **三方经验**（awesome-dsh-plugin 注册表，实测 1000 个插件条目）：三方声明普遍宽松——抽查 `dsh-api-balance`（engines 仅 node，无 dsh 约束）、`dsh-status-rotator`（peer cordis `*`）；官方包则是 monorepo 锁步（peer 只声明 cordis）。注册表 CI 只采集 npm 元数据做展示。结论：**社区没有现成的强兼容机制可抄，正确姿势就是「engines.dsh 下限 + 稳定子集纪律 + 升级冒烟」，并把实测过的宿主版本写进文档**。

---

## 3. R1 API key 原地编辑（对齐 Models 页）

【要求】

- **行形态**（收起）：`StateDot`（启用=done / 禁用=error）+ key 名 + `Tag`（「当前」=solid、「已禁用」=danger）+ 元信息行（现 `keyMetaText`）+ 右侧 `Button outline size="sm"`：使用 / 编辑 / 删除。
- **原地编辑卡**：点「编辑」该行原地展开为卡；`openKey` 单一状态——**同时只展开一张**，切换时若另一张有未保存草稿直接丢弃（对齐官方语义：卡各自持有草稿，整页一次一张）。卡内字段沿用现有表单（名称 / 分组 `MenuSelect` / 额度 radio+输入 / 有效期 radio+日期 / 启用 `Switch`），底部页脚照 `EditorFooter`：左「取消」右「应用」（busy 文案「保存中…」）。
- **提交即写**：「应用」→ `POST /api/relay/keys-update` → 成功收卡 + `role="status"` 通告「已保存 key 修改。」；失败**卡保持展开**并就地显示面板错误（`message` 透传）。
- **新建**：「+ 新建 key」在列表头部展开**新建卡**（同一字段集 + 「创建并设为生效」`Switch`），页脚「取消 / 创建」；与编辑卡互斥（同属一张 open 卡）。创建成功后的成功/警示文案沿用 v0.5.0。
- **删除**：改用 primitives `Modal` 确认框（title 指名 key；该 key 为当前生效 key 时 description 带警示句），footer「取消 / 删除」；确认 → `POST /api/relay/keys-delete`。原两段式按钮移除。
- locale 中英同步（新增/调整键见 §9）。

【建议基线】行内「使用」保持一键直发（官方页无对应物，保留现交互）；编辑卡宽度撑满行卡。

## 4. R2 复用 dsh 原生组件

【要求】映射表（现有 → 目标）：

| 现状 | 目标 |
|---|---|
| `relay_button` 手写按钮 | `Button`（primary / outline / ghost；小尺寸 `size="sm"`） |
| `relay_switch` 手写开关 | `Switch`（必填 `label`，受控） |
| `relay_chip`（模态/档位/口径切换） | `Pill`（`active` + `onClick`） |
| `relay_tag` / `relay_capBadge` 来源徽标 | `Tag`：当前=solid、已禁用=danger、覆盖=warning、知识库=success、近似=info、未配置=neutral、预置=quiet |
| key 启停状态点 | `StateDot`（done/error） |
| 删除/清除的两段式按钮 | `Modal` 确认框（§3、§7） |
| 下拉选择器（key 分组、日志的模型/密钥/分组筛选） | **`MenuSelect`**：本插件新增的小包装组件（LanguageRow 同款——anchor 按钮 + 当前值 + chevron + `Menu` portal `selectedId`/`onSelect`），全站统一 |
| 输入框 / 日期 | 保留手写字段块，但**样式对齐官方 `fields.tsx` + Models 页 vocabulary**（label 上、控件下、hint 尾随、invalid 高亮），token 用 `--dsw-alias-*` |
| 折叠区（预置库浏览、平台卡收起摘要） | 原生 `<details><summary>`（对齐官方「自定义设置」） |

【要求】约束：

- `dsh.client` 声明不变（primitives 在基座模块表内，无需 external 声明）；`tsdown.config.ts` 的 `CLIENT_EXTERNALS` 增补 `"@deepseek-ai/dsh-client-ui-primitives"`；`src/types/` 新增手写声明（§2.2）。
- 样式仍走单一注入样式表 + `relay_` 前缀（不迁移 CSS module——build-shape 契约与产物形态不变）；primitives 自带样式由其自身 CSS module 提供，无需我方复制。
- build-shape 测试同步：client 产物 bare require 白名单增加 `"@deepseek-ai/dsh-client-ui-primitives"`。

【建议基线】`DisclosureRow` 不用于卡片折叠（布局不符，见 §2.2）；`RiskConfirmation` 本次不引入（Modal 确认已够用，勾选把关适合更高危操作）。

### 4.1 宿主版本兼容策略（依 §2.6 实证）

【要求】

1. `engines.dsh` 保持 `">=0.1.5-rc.2"`——该线起模块表即含本插件所需的全部键；npm 安装面（当前 0.1.5-rc.3）天然覆盖。
2. **稳定子集纪律**：primitives 只用 §2.2 列出的组件与 props（全部在 rc.2 存在且经 §2.6 实测在 0.1.7-rc.1 仍兼容）；0.1.7 新增件（settings-form 套件、SegmentedControl、Checkbox 等）**不引入**，待 npm 宿主线跟上后另立任务评估。
3. 升级宿主开发依赖时的固定动作：`npm install @deepseek-ai/dsh@latest` 后**必须做一轮浏览器走查**（primitives 由宿主供给，npm 侧测试覆盖不到视觉与行为）；把实测过的宿主版本写进 README「Compatibility」小节与 PUBLISHING.md。
4. AGENTS.md 增补一条集成语义：primitives/模块表组件「宿主供给自己的编译版」——插件不得假设 npm 侧有该包，类型用 `src/types/` 手写声明，禁止从 submodule import。

---

## 5. R3 看板四卡一行

【要求】`.relay_dashCards` 改为 `grid-template-columns:repeat(4,minmax(0,1fr))`（小于 480px 视口才回落 `repeat(2,minmax(0,1fr))`）；卡片内边距与 `.relay_dashValue` 字号（18→16px）压缩到四卡在 ~690px 内容区一行放得下且数值不折行；溢出防护 `min-width:0` + 数值 `overflow-wrap:anywhere` 保留。

## 6. R4 日志筛选布局修复

【要求】

- 筛选区改两行结构：**第一行**=时间范围（占满整行：开始输入 flex:1、`~`、结束输入 flex:1，均 `min-width:0`）；**第二行**=模型 / 密钥 / 分组三个 select（各 `flex:1 1 0; min-width:0`）+ 右对齐「查询 / 重置」。任何宽度下不再叠压。
- 下拉空选项文案按字段区分：模型名称→「全部模型」、密钥名称→「全部密钥」、分组→「全部分组」（中英 locale 新键，替换共用的「选择分组…」）。
- 【建议基线】顺带微调表格列宽比例与费用列字号（不改列结构与语义）。

## 7. R5 模型能力页重构

### 7.1 知识库预置（编译期拉取，进代码）

【要求】

- 新增 `scripts/fetch-knowledge-preset.mjs` + npm script `preset:fetch`，两步取数：
  1. **面板支持模型（主源，§2.5 实证公开免鉴权）**：`GET <面板>/api/pricing` → `model_name` 集合 → 用与运行时**同一份匹配规则**（`matchCatalogName`：精确 → 剥一至两层变体后缀）规范化为 models.dev 标准名 → 去重；命中者才进入预置（面板特有模型如 `grok-video` 落弃）。面板地址：`--panel <url>` 显式指定，缺省自动读仓库 `.dsh-home/settings.yaml` 的 `relay.baseUrl`（只读该一个字段，脚本不读取、不输出任何令牌；产物不得携带任何账号信息）。
  2. **主流 provider 白名单（基源）**：拉 `https://models.dev/api.json`（走 `https_proxy` 环境代理），取 openai、anthropic、google、google-vertex、deepseek、alibaba、moonshot、x-ai、mistral、z-ai 等白名单 provider 的全部模型（实施时按 api.json 实名核对）。
  两源按模型名**并集**，逐名经**现有** `mapModelsDevEntry`+`mergeSuggestions` 同构逻辑（含 `limit.context` 取最大）合成能力条目，输出 `src/knowledge-preset.generated.ts`：
  ```ts
  // Generated by `npm run preset:fetch` — do not edit.
  // Sources: models.dev api.json @ <ISO 日期>; panel <baseUrl 主机名> pricing (N models → M preset entries)。
  export const KNOWLEDGE_PRESET: Record<string, PresetEntry> = { … }
  ```
  文件**提交进 git**；普通构建/测试不依赖网络。脚本输出摘要（两源条数、并集数、丢弃的面板特有名列表）供报告引用。
- **运行时合并语义**（`src/knowledge.ts`）：知识层 = `capabilityCatalog`（用户，namespace）**覆盖同名**预置条目；派生匹配 `matchCatalogName` 跑在「用户名集 ∪ 预置名集」上，命中用户条目优先。预置条目**不落 settings**、无删除语义（压制错误预置 = 建同名用户条目覆盖），不引入墓碑键。`GET /api/relay/capabilities` 增加 `presets` 字段（完整预置映射）供客户端浏览。
- 预置条目由宿主模块持有；`preset:fetch` 重跑 = 更新提交的基线。

### 7.2 知识库统一刷新

【要求】

- 新路由 `POST /api/relay/knowledge-refresh`：宿主强制绕过 TTL 重新拉取 models.dev（`ModelsDevClient` 增加 `refresh()`），用与构建脚本**同一份白名单与并集逻辑**（逻辑提取到宿主可复用的 `src/knowledge-preset.ts`，脚本 import 之）重建预置层，**存宿主进程内存**（重启回落到编译期基线——设计使然，刷新是「现查最新」，持久基线是提交的文件），返回 `{ ok, count }`。
- 能力页知识库区头只有一个「刷新预置」按钮（busy 态），去掉每行 ↻；刷新成功后视图更新 + `role="status"` 通告（含条目数）；失败显示可重试错误。知识库行编辑中的草稿不因刷新丢失（对齐「卡各自持有草稿」）。
- 知识库行上的 ↻ 与「从 models.dev 获取默认值」的逐行语义整体移除。

### 7.3 知识库 UI（两段式列表）

【要求】

- **我的条目**（namespace `capabilityCatalog`）：行 = 名称 + 摘要（模态 · 推理 · 窗口）+ `Tag`(quiet「自定义」或不再标) + 编辑/删除；「+ 新增」展开行内编辑卡。删除改 `Modal` 确认。编辑卡字段：名称、模态 `Pill`、推理 `Switch`+`Pill` 档位、上下文窗口文本输入（§7.4），页脚「取消 / 完成」。
- **预置条目**：整段收在 `<details><summary>预置条目（N）</summary>` 内，顶部过滤输入框按名过滤；行只读展示 + 「编辑」（等价复制为同名用户条目并进入编辑态）。刷新按钮位于 summary 行右侧（§7.2）。
- 编辑语义：编辑预置名 = 写同名用户条目（徽标转为「自定义」）。

### 7.4 上下文窗口 `1M`/`256K` 写法

【要求】

- 输入为**文本框**；解析函数 `parseContextWindow(text)`：去空白/逗号/下划线；纯数字直接用；`K/M/B` 后缀（大小写不敏感）按 **K=1024、M=1024²、B=1024³** 换算（与「128K=131072」业界惯例一致）。非法输入（负数、非整数结果、未知后缀、0、>10,000,000）拒绝保存并就地提示。
- 输入时实时在 hint 显示换算值（如 `1M = 1,048,576`）；落盘仍为数字（namespace schema 不变）。
- 宿主侧校验（`validateCapabilityEntry`）保持纯数字正整数不变——换算只发生在客户端输入层。客户端 `entryFromDraft` 接收已换算值。

### 7.5 平台模型卡收起 + 完成即存

【要求】

- 平台卡**默认收起**：头行 = id（等宽字体）+ vendor `Tag` + 来源徽标 `Tag` + 摘要文本（模态 · 推理 · 窗口，来自派生视图）+ chevron 图标与「编辑」按钮。
- 「编辑」原地展开（`openId` 单一状态，整页一张卡）：字段 = 模态 `Pill`、推理 `Switch`+档位 `Pill`、上下文窗口（§7.4）；页脚「取消 / 完成」。**「完成」即保存**：POST → 成功收卡 + `role="status"` 通告；失败保持展开显示错误。「取消」丢弃草稿收卡。清除覆盖入口保留在展开态（`Modal` 确认）。
- **右上角全局「保存」按钮删除**；v0.5.0 的批量 dirty 跟踪 / reconcile 批量草稿保留逻辑随之简化为「单卡草稿」（跨重建保留由「一次一张卡 + 提交即写」天然保证，`reconcileKbRows`/`reconcileOverrides` 相应收缩或移除，相关单测重写）。
- **API 契约变更**：`POST /api/relay/capabilities` body 从整体字典改为**定向操作**：
  ```json
  { "catalogSet": { "<name>": {…} } | undefined,
    "catalogDelete": ["<name>", …] | undefined,
    "overrideSet": { "<id>": {…} } | undefined,
    "overrideDelete": ["<id>", …] | undefined }
  ```
  宿主：校验（沿用 `validateCapabilityEntry`）→ `settings.mutate` 逐条 `set`/`unset` 路径操作（path 寻址 `capabilityCatalog.<name>` 等，天然解决 v0.5.0 深合并删除难题）→ 整体重放 §3.1 落点规则（一次修订守卫写）→ 返回最新 `models` 视图（含来源徽标数据）。响应形如 `{ ok, models }`。
- 【要求】「完成即存」的每次写都要 await 落定再响应（红线不变）；连续快速保存由 mutate 队列串行保证。

---

## 8. 测试与验收

【要求】全部在隔离环境完成（隔离 home 从零创建 + 3198/3298 端口 + 扩展 `tests/mock-relay.ts`），沿用 SPEC-0.5.0 §9 的真实账号边界（只读随意；写路径一次性 `dsh-temp-` key）：

1. **mock 面板**：无需新端点（本轮全部需求在插件侧）。
2. **单测**：
   - `parseContextWindow`（`1M`/`256K`/`1,048,576`/大小写/逗号/非法值矩阵，K=1024 约定断言）；
   - 预置合并派生（用户覆盖同名预置、`matchCatalogName` 跑合并名集、近似命中预置）；
   - 预置取数纯函数（面板 id 规范化→去重→并集，面板特有名丢弃；以 fixture 取代真实网络）；
   - 定向 ops 的 `/capabilities` 处理（catalogSet/Delete、overrideSet/Delete 的 mutate 路径形状 + 删除真实生效 + 重放一次写）；
   - 知识刷新（`refresh()` 绕过缓存单飞、白名单并集产物形状、内存层回落基线）；
   - build-shape：client bare require 白名单 + primitives require 存在 + 产物无裸 import。
3. **浏览器验收**（隔离实例 + mock + 中英双语各一遍）：
   - `MenuSelect` 下拉全站行为（锚点按钮当前值、portal 弹层不被对话框裁剪、选择后即合、Escape/外点关闭）；
   - key 行编辑卡：一次一张、应用即写、失败卡不收、删除走 Modal、启用 `Switch` 生效（status_only 语义回归）；
   - 看板四卡一行（~690px 视口实测不换行）；
   - 日志筛选两行不叠压、三个下拉占位文案正确、查询/重置可用；
   - 能力页：预置条目折叠区可见且可搜、统一刷新按钮（断网态错误可重试）、上下文窗口 `1M`/`256K` 输入换算与拒绝、平台卡收起/展开、完成即存 + 落盘断言（`settings.yaml` 精确断言 catalog/override 增删与路由条目重放）、无全局保存按钮；
   - 中英文案齐整（含 §6 下拉占位、§7 各新键）。
4. **真实账号验收**：只读（能力页预置命中面板模型抽查、刷新按钮实网一次）；写路径临时 key 编辑/启停闭环一次（status_only 回归）。`preset:fetch` 实跑一次（缺省读 `.dsh-home` 的 baseUrl）并报告两源条数、并集数、丢弃的面板特有名与产物体积增量；脚本运行全程不回显任何令牌。
5. 质量门：typecheck 0 error → vitest 全绿 → 浏览器中英过 → 进程按 PID 杀净 → `.tmp/` 清理 → `git status` 无杂物。

## 9. 文档交付

README（中英）：key 原地编辑、能力页预置库与刷新、`1M/256K` 写法截图与说明，新增 **Compatibility** 小节（实测宿主 0.1.5-rc.2/rc.3，primitives 跨 0.1.7-rc.1 子集兼容实测）；CHANGELOG 0.5.1；AGENTS §1/§8 同步（primitives 消费纪律、宿主供给机制、预置层语义）+ §4 集成语义新增一条（§4.1 第 4 点）；PUBLISHING.md 补「宿主兼容」清单项；WORKLOG 0.5.1 条目（含兼容调研结论）；assets 六页签中英截图重拍（mock 数据）+ `screenshots.json`。locale 新增/变更键清单：全部模型/全部密钥/全部分组、刷新预置、预置条目（N）、自定义、完成、上下文换算 hint、删除确认 Modal 文案等。

## 10. 完成定义（DoD 自检单）

- [ ] key 编辑在行内原地进行，一次一张卡，应用即写、失败不收卡；删除走 Modal；中英走查过
- [ ] Button/Switch/Pill/Tag/StateDot/Modal 来自 primitives；build-shape 白名单更新且产物无裸 import；react 系 + primitives 外置、recharts 等其余照旧打包
- [ ] 看板四卡一行（内容区 ~690px 实测）
- [ ] 日志筛选两行结构不叠压；三个下拉占位文案按字段正确
- [ ] 下拉统一 `MenuSelect`（Menu portal），设置对话框内不裁剪、可键盘关闭
- [ ] `npm run preset:fetch` 产出 `src/knowledge-preset.generated.ts` 并入库（主源=面板 `/api/pricing` 公开接口规范化并集主流白名单，无凭据参与）；预置层参与派生匹配（用户覆盖同名）；知识库单一「刷新预置」按钮（绕缓存、内存层、可错误重试）；逐行 ↻ 移除
- [ ] 上下文窗口支持 `1M`/`256K`（K=1024）并实时显示换算；非法值宿主与客户端双端拒绝
- [ ] 平台卡默认收起、编辑展开、完成即存；全局保存按钮删除；`/capabilities` 定向 ops 有单测且删除真实生效
- [ ] 宿主兼容：`engines.dsh` 下限与稳定子集纪律落进 AGENTS/PUBLISHING/README；build-shape 断言 primitives require 外置
- [ ] typecheck + vitest 全绿；浏览器中英走查过；真实账号只读对账 + 临时 key 闭环；清理完成；commit 按操作者指示

## 11. 风险与提示

- **primitives 未随 npm 安装**：运行时由宿主模块表供给（§2.6），但 tsdown 对「未安装且 external」的导入要实测——若 rolldown 解析报错，回退方案：devDependencies 增加该包（仅构建期解析与类型，宿主运行时仍供给自己的版本），或构建别名指向 submodule 源码（不得打进产物）。
- **宿主版本漂移**：npm 宿主线更新（>0.1.5-rc.3）或用户跑在更新 git tag 宿主上时，primitives 可能继续演进——按 §4.1 纪律只消费稳定子集、升级后冒烟；若未来出现破坏性漂移，先在 `MenuSelect` 等包装组件内做能力探测收敛爆点，不在业务代码里散落 try/catch。
- **类型声明自写**：primitives 的 props 以 §2.2 源码为准，写最小 `.d.ts`；不要为了图省事 `any` 化（正确性 > 便捷性），也不要 import submodule 的 `.ts`（CSS module / allowImportingTsExtensions 会拖垮我方 tsconfig）。
- **「完成即存」的粒度**：平台卡上一次编辑就是一次 POST + 一次重放写；重放是整目录一次修订守卫写，频率可控。切忌把「保存」拆成每字段即时写（对齐官方「应用」粒度，不更细）。
- **预置层刷新不持久**是设计而非缺陷（README/设置页 hint 写明）；持久基线靠重跑 `preset:fetch`。白名单调整 = 改代码 + 重跑脚本，不做运行时白名单配置。
- **K=1024 约定**与部分面板（如 Claude 200K=200000）存在 2.4% 级偏差——实时换算 hint 让用户所见即所存；不做双单位切换（复杂度不值）。
- **Mock/自动化交互回归**：Modal 与 `MenuSelect` 弹层（portal）在 dsh 设置对话框内的指针行为需按 AGENTS §6 的经验（cua 坐标 / dom_cua / 点击后验证再重试）走查，不能因换了组件就假设 locator 点击可用；Menu 的 portal 定位在对话框滚动时是否跟随要在走查中确认（源码称随 scroll/resize 重定位）。
- **`reconcileKbRows`/`reconcileOverrides` 收缩**：删除批量草稿机制时，注意保留「服务端数据刷新不清掉打开中的草稿」这一条（单卡草稿仍在组件状态里），防回归单测要重写而非删除。
