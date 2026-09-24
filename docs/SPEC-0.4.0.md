# dsh-plugin-relay → v0.4.0 开发任务书（Spec）

> **状态：已实施（2026-09-22）。** 实施结果与验收证据见 `docs/WORKLOG.md` v0.4.0 条目；命名/能力落点与 §3/§5 建议的两处偏离（`modelOverrides` 不可用、Tab 自绘）及理由见 WORKLOG 与 AGENTS.md §4.3。
> **后续修订（2026-09-22，用户决定）**：R1 中「老配置自动迁移」在实施后**整体移除**——插件未正式发布，不存在存量旧命名环境；README/测试/文档中的迁移章节同步删除。
> **执行者**：接手本任务的 AI 编码会话（无人值守自主完成开发、测试、验收、文档）。
> **开工前必读**：仓库根 `AGENTS.md`（红线与 dsh 集成语义，全程遵守）、`README.md`、`docs/WORKLOG.md`（历史与事故）。本任务书 §2 收录了已核实的 dsh 内部事实，可直接引用，不必重新考古；需要更多事实时**联网查证或读源码，禁止凭空编造**。

---

## 0. 执行守则

**硬性约束**（违反即失败）：

1. AGENTS.md §0 红线全部有效：不碰操作者自己的 dsh home 与实例；只按 PID 杀自己起的进程；手工起 dsh 内联 `DSH_HOME=<隔离目录>`；`.dsh-home` 若存在即视为真实配置；密钥/测试信息不入 git；隔离测试 home 从零 `dsh plugin add` 创建（禁止 `cp -R` 复制）；临时产物进 `.tmp/` 收尾删除。
2. **不修改本工作区之外的任何文件**；参考外部仓库/资料只读。commit 仅在用户明确要求时进行。
3. settings/credentials 写入在请求处理器里必须 `await` 落定再返回响应（AGENTS.md §4.1 竞态教训）。
4. 真实账号（授权边界见 AGENTS.md §6）：只读调用可随意；`/use` 等改写操作只在隔离 home 测。

**工作方式**：

5. **结果导向**：本任务书只对 §8 的验收要求和 §9 的 DoD 负责。标注【要求】的条目是验收契约；标注【建议】的是经验基线，**你可以自主决策偏离**——选型、目录、命名细节、实现机制均由你判断，但偏离时须在最终报告里说明理由。
6. **正确性 > 便捷性**：不为省事牺牲可读性与可维护性。类型要真实表达领域（不是 `any` 摆设）、模块职责清晰、与现有代码风格一致、不留只有自己能看懂的捷径。
7. **多联网搜索实际求证，少凭空猜测**：dsh/schemastery 的 API、第三方服务的数据形态、npm 包的用法，不确定就搜官方文档或读 `node_modules` 源码验证；引用外部事实时在报告里注明出处。外网直连失败时按环境配置代理。

---

## 1. 背景与目标

v0.3.0 插件以某个具体面板为默认集成目标，包名、字段、文案均带该面板专名字样（历史专名哨兵见 tests/build-shape.test.ts 的命名审计）。v0.4.0 四项需求：

| # | 需求 | 结果描述 |
|---|------|----------|
| R1 | 去专名化 | 插件定位为**通用中转站对接插件**（new-api 家族，任意同类面板）；包名/字段名/文案/注释全面通用化，**无任何面板专属默认值** |
| R2 | 移除 prettyModelName | 模型只认 id：删除「模型名称」的生成、字段与展示 |
| R3 | 设置页多选项卡 + 「模型能力」 | 设置页改多 Tab；新增「模型能力」Tab 配置各模型输入模态与推理档位，与官方「模型」页写同一份配置、字段级合并互不覆盖；能力初值可联网获取、可手动改、可手动加模型 |
| R4 | TypeScript 重构 | 源码 TS 化、构建出 JS，包形态对齐优秀 dsh 插件实践 |

版本号 `0.4.0`。

---

## 2. 已核实的关键事实（直接引用，不必重查；出处已在括号标明）

### 2.1 `llm-pi-ai` 模型能力 schema（`node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js`）

- 请求模态枚举：`["text", "image"]`，仅两种。
- 思考档位枚举（升序）：`off, minimal, low, medium, high, xhigh, max`。
- provider profile 相关字段：
  ```text
  models: [{ id*, name, contextWindow, maxTokens, input, reasoningEfforts, compat }]
  modelOverrides: { <modelId>: { 同 models 条目的可选字段子集 } }   // 按模型覆盖层
  defaultInput / reasoning                                        // 路由级默认
  ```
- `reasoningEfforts` 两态：`false`（明确非推理）或字典 `{<档位>: <线上拼法 string|null>}`；空字典非法；`off` 之外的档位值必须非空字符串（`off` 可 null）。
- 能力解析分层：`modelOverrides[id]` > `models[]` 条目 > 内置目录；`input` 空数组 = 未声明（继承下层）。
- **`modelOverrides` 就是官方「模型」设置页的按模型覆盖机制**（编辑的就是 `llm-pi-ai` 这份配置）。

### 2.2 settings 服务（`@deepseek-ai/dsh-settings`）

- `update(ns, patch)` 深合并：对象递归合并、**数组整体替换**；`mutate(ns, ops)` 支持 path 级 set/unset。写入排队串行异步，响应前必须 await。

### 2.3 客户端模块契约

- 浏览器入口构建产物形状：`window.__ModuleLoader__.load({ id, factory: (require) => <CJS module，exports = {inject, apply}> })`；`inject` 声明所需 ctx 能力（当前为 `["slots","locale","settingsScope"]`）；`require("react")`/`require("react/jsx-runtime")` 由宿主供给（react 不必装进本包，类型用 `@types/react@~18.3`）。
- 包清单：`dsh.client = { platform: "web", inject: [<dsh client 模块>] }` + `exports["./client"]` 指向浏览器产物。
- **参考实现**：社区与本地的优秀 dsh 插件仓库（只读参考）——`tsdown.config.ts` 多产物配置（宿主 ESM / client CJS），client 用 banner/intro/footer 包成上述 `__ModuleLoader__` 形状，测试用 vitest，类型检查 `tsc --noEmit`，TS strict + react-jsx。

### 2.4 模型能力网络源 `https://models.dev/api.json`（已实测）

- `{ <providerId>: { models: { <modelId>: entry } } }`；entry 关键字段：`modalities.input`（如 `["text","image","pdf"]`）、`reasoning: boolean`、`reasoning_options: [{type:"effort",values:[…]} | {type:"toggle"}]`、`limit: {context, output}`。同一模型可能以不同 id 出现在多个 provider 下。
- 其余事实（管理 API 鉴权、`/api/pricing` 字段与三种计价方言、credentials 解析层级、信任围栏）：见 AGENTS.md §4–5，全部沿用。

---

## 3. R1 去专名化

【要求】

- 命名全面通用化且**全仓库一致**：包名、宿主插件名、settings namespace、HTTP 路由前缀、pi-ai 路由 id、凭据 keyRef 默认值、locale NS、CSS 前缀、客户端模块 id——不允许任何一处残留面板专属命名或默认值（含 `baseUrl` 默认值清空、patch 中的 displayName/baseURL/预置模型）。
- patch（`cordis.patch.yml`）改造后，**干净 home 安装启动无错**、设置页填上面板信息即可用；`baseURL` 不再依赖 patch 硬编码——连接信息保存/切换 key 时由插件动态下发到路由配置。
- 文案（中英）、注释、README 的表述全部通用化（「中转站 / new-api 系面板」）。

【建议基线】命名取 `dsh-plugin-relay` / `relay` / `/api/relay/*` / `RELAY_API_KEY` / `relay-ui` / `relay_`，可自行斟酌，但必须语义通用、全局一致；预置模型目录建议留空（不预置任何面板专属模型）。

> 历史备注：原任务书此处还包含「老配置自动迁移」的【要求】条目（读别名 + 幂等拷贝 + 测试覆盖）。实施完成后按用户决定整体移除——插件未正式发布，无存量环境。实施期间沉淀的迁移踩坑教训（composition base 层字段丢失、resolved 值已被 schemastery 具体化不可照抄）保留在 WORKLOG，对今后任何「改共享配置结构」的工作仍有参考价值。

---

## 4. R2 移除 prettyModelName

【要求】模型身份只用 id：删除名称生成逻辑与「名称」列；目录条目仍需满足 `llm-pi-ai` schema（`name` 字段可写 id 原值）；`/models` 接口与模型 Tab 不再输出/展示名称字段；现有测试相应调整。

---

## 5. R3 多选项卡设置页 + 「模型能力」

### 5.1 多 Tab

【要求】设置区改为多选项卡组织：`连接 / API Keys / 模型 / 模型能力` 四块，前三块为现有内容搬迁；样式与 dsh 设计体系一致（用现有 design token）。Tab 机制优先调研 dsh 现成组件/插槽（读 `@deepseek-ai/dsh-client-ui-settings` 源码或联网求证），无现成机制再自绘。

### 5.2 「模型能力」Tab

【要求】（布局要素的文字化描述；成品对照逐项验收）

1. 页头：标题**「模型输入模态与推理强度」**+ 说明段（按「模型」统一配置一次，保存后自动应用到该模型接入的所有服务商；与官方「模型」页写同一份配置，字段级合并互不覆盖）+ 右上角**「保存」**主按钮（整页一个，一次提交全部改动）。
2. 每模型一张卡片：模型 id（等宽、加粗）+ 来源徽标（面板侧 vendor 名，`/api/pricing` 可提取）+ 右侧 **↻ 按钮**（联网获取该模型能力初值并填入表单，标记待保存）。
3. 卡内两行：
   - **输入模态**：`文本` / `图片` 两个多选 chip（选中=品牌蓝填充）；空选 = 跟随路由默认，需有提示。
   - **推理**：开关 switch；关 → 保存 `reasoningEfforts: false`；开 → 档位 chips `minimal/low/medium/high/xhigh/max`（多选、至少一个，前端校验；`off` 不作为 chip，写入时自动补 `off: null`）。
4. **手动添加模型**：底部「+ 添加」按 id 新增空卡，可直接配置并保存（不要求存在于面板目录）。
5. 模型集合 = 当前 key 可用模型 ∪ 已有覆盖配置 ∪ 手工添加。中英双语。

【要求·语义】写入目标必须保证「字段级合并、互不覆盖」：只写自己管理的字段/层，绝不整段替换 `llm-pi-ai`、绝不碰官方页管理的字段；目录同步（`/models`、`/use`）不得冲掉能力配置与手工字段（注意 §2.2 数组整体替换的坑）。**推荐落点 `modelOverrides`**（§2.1 的官方覆盖层，天然满足）；若你有更优方案，须达到同等保证并在报告说明。删除单模型覆盖配置的能力也要有。

【要求·初值获取】↻ 联网获取：主源 models.dev（§2.4），映射规则自定但要正确处理 effort/toggle/false 三态与模态交集；网络失败有兜底（明确提示手动），不得阻塞 UI；有缓存/节流，不炮轰外部服务。建议该请求经宿主路由代理（可复用代理 env、避免 CORS）。

【要求·手动修改与保存】所有卡片值可改；保存后**隔离 home 落盘断言**：能力落点写对了，`llm-pi-ai` 其余字段未动。

---

## 6. R4 TypeScript 重构

【要求】

- 源码 TS（strict），编译产物 JS；宿主入口、客户端入口、`cordis.patch.yml` 引用路径、`package.json`（exports/files/scripts/dsh 字段）全部对齐新结构；`npm start`（`scripts/dev.js`）继续可用。
- 构建产物契约正确：宿主为 Node ESM；客户端为 §2.3 的 `__ModuleLoader__` 包裹形状（构建或测试中自动断言，不靠肉眼）。
- `typecheck` / `build` / `test` 脚本齐备且全绿；类型真实有意义（领域类型、最小化的 dsh 服务结构声明——官方包不发布 `.d.ts`，需自备）。
- 测试框架自选（实施取 vitest）。

---

## 7. 参考资源

| 资源 | 用途 |
|---|---|
| `node_modules/@deepseek-ai/dsh-*` 各包源码 | schema/服务语义的最终依据（无 .d.ts，读 lib/*.js） |
| `https://models.dev/api.json` | 能力初值主源（§2.4 已核实字段） |
| 优秀 dsh 插件仓库（只读） | tsdown 配置、src 组织、client 入口与 CSS 处理、vitest 实践 |
| 联网搜索 | 官方文档、schemastery 用法、npm 命名冲突、其它优秀 dsh 插件实践；不确定的事先查证 |

---

## 8. 测试与验收

【要求】全部在隔离环境完成（隔离 home 从零创建 + 独立端口；mock 面板）：

1. 单测/集成测试覆盖：R1 命名通用化的机械校验（交付物历史专名哨兵零命中——历史文档豁免）、R2 目录条目 name=id、R3 能力映射三态、覆盖配置的合并写入与删除、目录同步不冲手工字段、构建产物形状；既有用例适配后不回退。
2. 浏览器验收（browser-use / web-gui-tester 技能）：干净 home 全新安装启动无错；四 Tab 可切、布局对照 §5.2 逐要素；全流程（连接 → keys → use → 模型 Tab → 能力配置 → 保存）；**落盘断言**（settings.yaml 的 `llm-pi-ai` 变化精确符合预期、其余字段未动）。
3. 质量门：typecheck 0 error → 测试全绿 → 浏览器验收过 → 自起进程按 PID 杀净 → `.tmp/` 删除 → `git status` 无杂物。

## 9. 文档交付

`README.md` 重写为通用定位（安装/开发/原理/安全/限制 + 新 UI 说明）；`AGENTS.md` 更新受影响章节（命名、路由、能力语义、包名变更需重装 profile 的提示）；`WORKLOG.md` 追加 v0.4.0 条目（改动、验收证据、遗留）；本文件顶部标注「已实施（日期）」。

## 10. 完成定义（DoD 自检单）

- [x] 历史专名哨兵对 <源码/产物/patch/README/package.json> grep 零命中
- [x] typecheck + build + 测试全绿（合并/映射/产物形状均有用例）
- [x] 干净隔离 home 安装启动无错；浏览器验收全过并有落盘断言与截图证据
- [x] 三份文档更新；WORKLOG 有 v0.4.0 条目
- [x] 工作区外零改动；清理完成
- [x] 最终报告：改动摘要 + 关键决策与理由（含对【建议】的偏离）+ 验收证据 + 联网求证出处

## 11. 风险与提示

- patch 去掉硬编码后，`baseURL` 空值是否被 pi-ai schema 接受需实测（干净 home 启动验证）；不行就换机制，机制自选、结果必须达成。
- `settings.mutate` 的 unset 语义用前读源码（`dsh-settings` 的 `applyPathOp`）。
- `reasoningEfforts` 非法值会被 settings 校验拒绝：写入前在宿主侧校验档位与值。
- models.dev 数据是第三方快照，映射规则按 §2.4 三态设计，别假设所有模型都有 effort 数组。
