# 工作日志 — dsh-plugin-relay

目标：写一个 DeepSeek Harness（`@deepseek-ai/dsh`，下称 dsh）插件，接入 **new-api 系中转站面板**：API key 浏览/切换、按 key 自动发现模型、自动配置 dsh。开发启动走 3098 端口，`DSH_HOME` 隔离在仓库 `.dsh-home`。

约束：`@deepseek-ai/dsh` 装为本地依赖；不改工作区外文件；临时目录在 workspace 内自行清理；外网直连失败时按环境配置代理。

> 脱敏说明：本文档已去除真实面板地址、账号 ID、key 名称、余额等一切个人/环境信息；涉及真实账号的段落只保留经验教训。

---

## 2026-09-21（v0.1.0 — CLI + bundle 基础版）

### 1. 调研 dsh 架构（npm 直连正常，未用代理）

- `@deepseek-ai/dsh@0.1.5-rc.2`（launcher）＋ 100+ `@deepseek-ai/dsh-*` 插件包，MIT，repo: deepseek-ai/deepseek-harness。
- 机制确认：
  - profile 在 `$DSH_HOME/profiles/<name>`，首次启动自动从模板初始化；`dsh web --port N` 起 browser UI。
  - bundle = 声明 `dsh.bundle.patch` 的 npm 包（patch 为 cordis 条目数组）；`dsh plugin --profile <p> add <pkg>`（转发 pnpm）安装后**自动追加**进 `dsh.profile.bundles`。本地目录安装为 `link:` 软链，便于调试。
  - LLM 接入两条路：`dsh-llm-deepseek`（deepseek-official 路由，可覆盖 baseURL）与 `dsh-llm-pi-ai`（任意 OpenAI 兼容网关路由 + 模型发现），base 已挂 pi-ai（零路由休眠）。
  - **配置热更新**：`$DSH_HOME/settings.yaml`（namespace 分节，`llm-pi-ai:` 按提供方字段级合并、`agent-default-model:` 为默认模型运行时真源）与 `$DSH_HOME/.credentials.yaml`（`refs.<NAME>` 凭据，`apiKeyEnv` 按请求解析）都被 dsh watch，改文件即生效、无需重启。→ key 切换可以做到零重启。

### 2. 探测中转站 API

- 实证面板为 new-api 家族（`/api/status` 公开，自定义 fork）。
- 管理 API 鉴权：`Authorization: Bearer <访问令牌>` ＋ `New-Api-User: <用户ID>` 双头配对；缺 id →「未提供 New-Api-User」，id 不配对 →「与登录用户不匹配」。
- **用户 ID 自动探测**：尝试用令牌做配对探测（只有本人 id 会命中），顺序扫描未见命中（站点用户量大或 id 非顺序）。决策：停止扫描（避免触发风控），`user-id` 改为一次性手动配置 + `discover-user-id` 有界探测命令。
- `/v1/models`（OpenAI 兼容）用 sk- key 鉴权，作为「该 key 可用模型」权威来源；兜底用令牌 `models` 限制字段 / `/api/user/models`。

### 3. 设计定稿（v0.1.0）

- 插件包：bundle patch（pi-ai 路由 + 默认模型）+ CLI（此时代码带面板专名命名）。
- 凭据与 settings 编辑：原子写、0600/0700、保留注释、拒绝空 key、legacy 扁平凭据升级、`.env` 冲突检测。
- 端口 3098 进配置，`DSH_HOME` 显式指向 `.dsh-home`。

### 4. 踩坑记录（v0.1.0）

1. `yaml` 库：`Document.set/addIn` 对新键把普通 JS 对象原样存进 Pair（不走 createNode），后续 `setIn` 深入该层抛 "Expected YAML collection"。修复：一律 `doc.createNode(value)`、`refs` 层用真 `YAMLMap`。dsh web 自建的 `.credentials.yaml` 只有 `records:` 段（无 `refs`），正好踩中。
2. dsh 凭据固定优先级：启动环境 > 凭据文件 > 两级 `.env`。CLI 增加冲突检测告警。
3. headless 与 web 是两棵 profile 树：bundle 需分别安装；settings/credentials 是 home 级共享。

### 5. 验收（v0.1.0）

- mock 单测 16 用例全过；真实联调：面板可达、headless 实弹到真实面板拿到真实 401（管线证明）、web 于 3098 正常启动。

---

## 2026-09-21（v0.2.0 — Web 设置页 + 同类中转站支持）

需求变更：① 中转站 baseUrl / 访问令牌 / 用户 ID / key 切换放进 **dsh web 设置界面**；② 支持任意**同类（new-api 系）中转站**。

### 1. 再调研：dsh web 插件三个 seam

- **宿主 HTTP**：`ctx.connection.registerFetchRoute(ctx, {path, methods, requestBody, fetch})` —— `/api` 下的精确 Fetch 路由，自动套浏览器信任围栏（Host/Origin 检查 + 签名 cookie）。**必须声明 `requestBody: 'buffered'`**，否则 GET 请求走 streaming 分支构造带 body 的 Request 直接抛错（webserver 兜成空 400，极难排查）。
- **宿主 settings namespace**：`ctx.settings.installSection(ctx, ns, schema, base, hooks)` —— hooks 必须给 `setSource`（漏了报 `hooks.setSource is not a function`）；schemastery `z.string().role('secret')` 字段在 describe/wire 上自动脱敏。
- **浏览器端 UI**：包声明 `dsh.client: {platform:'web', inject:[...]}` + `exports['./client']`，client.js 是 `window.__ModuleLoader__.load({id, factory})` 格式的经典脚本（宿主扫描挂载行自动发现并合并进 `/plugins/??...` 组合包）；factory 返回 `{inject, apply(ctx)}`；`ctx.slots.inject('settings.section', () => ctx.slots.register({name,id,order,label,inject}, Component))` 注册设置页；React18 + `--dsw-alias-*` 设计令牌，样式用自注入 `<style data-plugin-css>`。
- Typert RPC（api-gateway）需要构建期描述符生成，第三方插件不可用 → 选 Fetch 路由方案。

### 2. 实现

- **宿主插件**：注册连接设置 namespace（baseUrl/relayKind/accessToken(secret)/userId/keyRef/route/selectedKeyName 等），bundle patch 行 config 作为 base 层。
- 路由：`GET /api/<ns>/state|keys|models`、`POST /api/<ns>/use|discover-user-id`。`use` 编排：planSwitch（共享核心层）→ `credentials.set` → `settings.update('llm-pi-ai')` → `settings.update('agent-default-model')` → `settings.update(<ns>, selectedKeyName)`。
- 服务引用通过 `ctx.inject(['settings'|'credentials'], cb)` 捕获——**cordis 守卫**：未声明的服务在 handler 里直接 `ctx.settings` 会报 "cannot get property without inject"。
- 所有 handler 套 `guarded()`：内部错误返回 JSON 500 而不是被 webserver 吃成空 400。
- **浏览器设置页**：连接表单经 `settingsScope.bind` 读写 namespace（revision 围栏、热生效）；key 列表/切换/模型同步走自研路由；双语（zh/en）locale。
- 踩坑：`useSyncExternalStore(scope.subscribe, scope.getSnapshot)` 方法未绑定 this → "reading 'store'" 崩溃；必须 `(fn)=>scope.subscribe(fn)` 箭头包裹。
- **泛化**：baseUrl 全面可配，协议实现按 new-api 家族（one-api/new-api/Veloera/done-hub 等共用 `/api/token/`+`New-Api-User`+`/v1/*`）。
- 修 v0.1.0 遗留 bug：`use` 写 `selectedKeyName` 时曾整段替换 namespace（丢令牌/ID）→ 改为合并写入（测试捕获）。

### 3. 浏览器实测（mock 面板）

全流程通过：设置导航出现插件区块 → 填连接信息 → 保存（settings.yaml 落盘、运行中 dsh 热加载）→ 刷新列出 mock keys（掩码、额度、禁用标记）→ Use → 提示切换成功且 `.credentials.yaml` 写入 sk-key、`llm-pi-ai` 目录同步、`selectedKeyName` 更新——全部落盘验证。

### 4. 事故记录与处置（重要）

- **DSH_HOME 误用**：一次重启服务时命令漏了 `DSH_HOME` 内联环境变量，dsh 回退默认 `~/.dsh`，把**操作者自己的 dsh 实例**起了起来（被发现并指出）。处置：立即停掉误启进程；核查该 home——真实数据（settings/credentials/sessions）**分毫未动**；误启进程新建的 `profiles/`（全新初始化）与 `storages/`（可重建投影缓存）已删除，home 恢复原状。教训：任何 dsh 启动命令必须内联 `DSH_HOME=<隔离目录绝对路径>`。
- 宿主 `/state` 曾把含明文令牌的原始 namespace 段带回浏览器（诊断字段）→ 已改为布尔 `namespaceRegistered`。

### 5. v0.2.0 交付物

- 宿主插件、浏览器设置页、bundle patch、CLI（同源配置）、双语 README。
- 测试：16/16。

---

## 2026-09-21（v0.2.1 — 修复 npm start 误用 ~/.dsh）

操作者执行 `npm start`，启动横幅显示 `DSH_HOME=~/.dsh`——落到了操作者自己的 dsh home。

- **根因**：`start` 的 home 解析按 dsh 标准链（flag > $DSH_HOME > `~/.dsh`），而开发验证时 shell 里始终带着 `export DSH_HOME=$PWD/.dsh-home`，从未在干净 shell 下测过。
- **修复**：home 解析顺序改为 flag > `$DSH_HOME` > **工作区 `.dsh-home`**（向上查找）> `~/.dsh`（最后兜底），所有命令统一走该解析。后续 v0.3.0 删 CLI 后由 `scripts/dev.js` 承接，且**强制锚定仓库 home、忽略外部 env**。
- 教训：涉及"用户 home 兜底"的默认值必须在干净环境（`env -u`）下测试；凡是我方工具可能碰到用户真实数据的路径，默认值必须锚定自己的工作区。

---

## 2026-09-21（v0.3.0 — 去 CLI 化、设置页体验重做、模型价格）

用户 7 项需求：取消自动探测用户 ID；修「进设置页 keys 不显示、每次要刷新」；刷新按钮与 API keys 标题同行；keys 不展示打码 key，改展示名称/分组/倍率等；模型列表改为当前 key 可用模型（id + 价格）；工程重排为「插件即仓库主体」，作为 npm 包发布，`@deepseek-ai/dsh` 转为 devDependency，删除 CLI；保留 `npm start` 仅作开发启动。

### 1. 工程重排

- 仓库根即插件主体；删除 CLI 时代产物（`yaml` 依赖随之移除——宿主全部经 dsh settings/credentials 服务读写，不再直接改文件）。
- 根 package.json 即插件清单：`files`/`exports`/`dsh.bundle`/`dsh.client`；`@deepseek-ai/dsh` 进 devDependencies。
- `npm start` → `scripts/dev.js`：强制 `DSH_HOME=<仓库>/.dsh-home`（**忽略**外部 env——v0.2.1 事故的直接教训），`--dsh-home/--port` 可显式覆盖。

### 2. 设置页修复与新 UI

- **keys 不自动显示的根因**：`refreshKeys` 只在切换 key 的 finally 里被调用，组件挂载时从未调用。修复：挂载即拉取 keys 与 models，另加「加载中…」占位；保存连接后也联动刷新。
- **刷新按钮与标题同行**：标题+说明在左、Refresh 在右。
- **keys 不再携带/展示 key 材料**：`keySummary` 只输出名称、分组、分组倍率（来自 `/api/pricing` 的 `group_ratio`）、额度、有效期、状态。
- **模型列表**：用当前生效 key 调 `/v1/models`，与 `/api/pricing` 合并出 {id, 价格, 可用分组}；三种计价口径都渲染；刷新列表时照旧把目录同步进 dsh。价格缺失时优雅降级（面板无 `/api/pricing` → 无价格列，不报错）。
- **自动探测用户 ID 移除**：路由与 UI 按钮/文案全部删除；用户 ID 恢复为纯手动填写（提示控制台「个人中心」或 `localStorage.user.id`）。
- **小补充**：切换到已禁用 key 时，成功消息附加警告。

### 3. 竞态修复（真因在服务端）

切换后「当前」标签不出现的第二层根因：dsh `settings.update()` 是**队列化异步写**，`/use` 里两处未 `await`，响应提前返回，客户端紧跟着的 `/keys` 读到旧值。修复：全部 `await`，保证响应返回即落定。

### 4. 真实面板协议新知

实证面板的 `/api/pricing` 公开可访问，字段比经典 new-api 更丰富（`billing_mode/input_price/output_price/cache_read_price/auto_groups/vendors`），分组倍率形如 `{"default":1,"<分组>":0.35,...}`。pricing 解析按「新式直价优先、经典倍率兜底、按次再兜底」实现，mock 覆盖三种口径。

### 5. `.dsh-home` 污染发现与处置

会话中一度发现 `.dsh-home/settings.yaml` 为 mock 验收残留值（浏览器验收经运行中实例写入）；准备恢复时发现操作者已通过设置页写入**更新的真实配置**——于是**一个字节未动**。验收方式随之改进：浏览器验收一律用**隔离 home**（`.tmp/` 下从零创建 + 独立端口 3198），真实 home 只在操作者自己的 `npm start` 下运行。

### 6. 验收

- 单测 16/16（pricing 降级与三口径、keySummary 无 key 材料、catalog、dev-home 锚定）。
- 隔离 home 浏览器全流程：进设置页 keys **即自动列出**（核心 bug 修复）；无打码 key；分组/倍率/额度/有效期齐全；模型列表含三种价格与分组列；Use → 成功消息 + active 标签即时出现 + 模型列表即时更新；Use 禁用 key → 警告文案；accept-home 磁盘校验（credentials.refs 写入、llm-pi-ai 模型目录、agent-default-model、selectedKeyName 合并保留）。

---

## 2026-09-21（v0.3.0 后续 — AGENTS.md 立册）

- **真实账号授权约定（长期有效）**：开发/测试可按授权使用真实账号做只读验证；测试信息（账号、key 名、余额）一律不入 git、不入文档。令牌值只存 `.dsh-home/settings.yaml`（gitignored）。
- **新增 `AGENTS.md`**：面向 Agent 的开发交接手册——红线（操作者实例禁区、只按 PID 杀进程、DSH_HOME 内联铁律、真实 home 不可当沙盒、密钥与测试信息不入库）、dsh 集成语义（settings 排队写必须 await、credentials 解析层级、信任围栏 401）、new-api 协议事实与三种计价方言、隔离 home 从零 add（勿 cp -R）、改动收尾清单、版本史。
- **只读冒烟两条路均未遂即止**：① 直接 curl 运行中实例的 API：被 dsh 浏览器信任围栏 401 挡住（符合设计，机制 = `requestRejection`）；② `cp -R` 复制真实 home 起隔离实例：profile bundle 解析断裂启动失败（教训：隔离 home 必须从零 `dsh plugin add`，勿复制）。

---

## 2026-09-21（v0.4.0 任务书立项 — 未实施）

用户下达 v0.4.0 四项需求（去专名化、删 prettyModelName、设置页多 Tab + 「模型能力」、TS 重构），并要求产出**无人值守可执行的任务书**。本阶段只做侦察与写任务书，不实施。

- 交付 **`SPEC-0.4.0.md`**（现 `docs/SPEC-0.4.0.md`）：执行守则、命名迁移全表、老配置一次性迁移设计、多 Tab 与模型能力 UI 规格、`modelOverrides` 写入语义、models.dev 映射规则、TS 工具链、测试计划、DoD 自检单。
- **为任务书核实的关键 dsh 事实**（写进 SPEC §2，后续会话免考古）：
  - `llm-pi-ai` 模型条目能力字段：`input: ["text"|"image"]`、`reasoningEfforts: false | {<档位>: <线上拼法|null>}`，档位 `off/minimal/low/medium/high/xhigh/max`。
  - `settings.update` 深合并对象、**数组整体替换** → 目录同步需宿主侧按 id 预合并。
  - 客户端模块契约：`window.__ModuleLoader__.load({id, factory(require)})` 产出 CJS `module.exports = {inject, apply}`；react 由宿主供给（类型用 @types/react@~18.3）。
  - `https://models.dev/api.json` 实测可达，entry 含 `modalities.input / reasoning / reasoning_options`，可作能力初始值来源。
- **任务书修订（同日，按用户反馈）**：改为结果导向——条目分【要求】（验收契约）与【建议】（可自主偏离的基线）；新增工作方式三条：正确性>便捷性、多联网求证少编造、不修改工作区外文件。

---

## 2026-09-21/22（v0.4.0 — 去专名化、删 prettyModelName、四 Tab + 模型能力、TypeScript 重构）

按 SPEC 无人值守实施四项需求。包名 → **`dsh-plugin-relay`**，namespace/route/keyRef/pi-ai 路由全部通用化（`relay` / `/api/relay/*` / `RELAY_API_KEY` / `relay`），交付物历史专名哨兵零命中（tests/build-shape.test.ts 内置机械审计，哨兵明文不落文档）。

### 1. 去专名化 + 老配置迁移（迁移后于 2026-09-22 按用户决定移除，见下一条）

- 命名总表收口 `src/constants.ts`；patch 收缩为**只有插件挂载行**（dsh-base 自带 pi-ai 休眠挂载与 agent-default-model 默认行）。路由（api/baseURL/apiKeyEnv/models）与默认模型全部改为运行时写入 settings.yaml。
- **迁移设计（当时实现，现已删除）**：读别名 + 一次性幂等拷贝，覆盖旧 namespace 段、旧凭据 ref、旧 pi-ai 路由、默认模型四项。
- **真实 home 升级踩坑（重要，教训仍适用）**：旧 profile 的连接字段（api/baseURL）在旧 patch 的 composition base 层，装新 bundle 即消失——从 resolved 值取连接字段会取到空，pi-ai 严格校验拒绝写入。修复思路：缺失的连接字段从旧 namespace 的 `baseUrl` 推导（`<baseUrl>/v1` + openai-completions）；容量默认只信 raw 值（resolved 值已被 schemastery 具体化，不能照抄）。

### 2. 删 prettyModelName

- `catalog.ts` 不再生成名称：同步条目 `name = id`（满足 pi-ai schema），`/models` 响应与模型 Tab 无名称字段/列；`mergeCatalog` 按 id 合并，**存活 id 的既有字段全部保留**，新增 id 走容量启发式，消失 id 移除（路由目录 = key 可调用集）。

### 3. 四选项卡 + 「模型能力」

- 设置区自绘四选项卡（连接 / API Keys / 模型 / 模型能力），样式沿用 `--dsw-alias-*` token；dsh 无现成 Tab 插件原语（设置侧边栏的粒度是整个 section），自绘。
- **能力落点**：pi-ai 源码明确 `modelOverrides` 在「带 models 列表的路由」与「内置目录未描述的路由」上直接 invalid，中转站路由两者皆是 → 能力写 **models 条目自身的 `input`/`reasoningEfforts`**，与官方「模型」页同一份条目。保存走 `settings.mutate` 单操作（set 整个 models 数组）+ `expectedRevision` 修订守卫 + 冲突重试 3 次，只改能力字段；目录同步（/models、/use）经 `mergeCatalog` 按 id 预合并，不冲掉能力配置与手工字段（浏览器 E2E：切走→切回 key 两次同步后能力字段完好）。**语义边界**：切换 key 使模型离开目录时，其能力配置随条目移除——条目级存储的固有属性。
- ↻ 联网参考值：`GET /api/relay/model-info` 经宿主代理 models.dev（进程内 24h 缓存 + 单飞合并；失败不阻塞 UI）。映射三态：effort 数组→档位交集；toggle/budget_tokens→推理开+medium 起步；false→显式非推理；多 provider 同 id 取并集。
- **React 18 教训**：能力卡片列表由 useEffect 按服务端数据重建，依赖里放了每次渲染新建的 `Set` → 任意重渲染都会吞掉用户草稿（浏览器实测抓到：开关点完即复位）。修复：`useMemo`/`useCallback` 稳定依赖 + `reconcileCards` 纯函数（脏卡片草稿跨重建保留，单测回归）。
- **内嵌 webview 吞 `window.prompt/confirm`**：添加模型改内联输入行，清除/删除改两段式按钮（点一次变「确认？」）。
- 设置对话框会拦截 playwright locator 的指针点击（actionability 超时）——浏览器自动化要点按钮需 cua 坐标/dom_cua node 路径，且点击可能被吞、要点后验证。

### 4. TypeScript 重构

- `src/`（strict TS）→ tsdown → `lib/index.js`（宿主 ESM；externals 仅 schemastery）+ `lib/client.js`（CJS，`window.__ModuleLoader__.load` banner/intro/footer 包裹，externals 仅 react/jsx-runtime）。CSS 沿用单一注入样式表 + `relay_` 类前缀（少一个构建依赖，前缀已保证无碰撞）。scripts/dev.js 保持 JS（附 dev.d.ts 供测试导入）。
- 测试 vitest 全绿 + `tsc --noEmit` 零错误；产物形状（包裹/exports/externals）有测试自动断言。
- **dsh fetch 路由按 path 唯一注册**（新坑）：GET/POST 各注册一条同名路径会让第二条 throw 并中断整个 inject 回调（之后的路由全没挂上，浏览器表现为神秘 404）。已改为一条路由 `methods:['GET','POST']` + handler 内分支。

### 5. 验收证据（隔离环境）

- 干净 home（从零 add）+ mock 面板（三计价方言 + vendors）：四 Tab 渲染；连接保存落盘；Use → `.credentials.yaml` 增凭据、`llm-pi-ai.providers.relay` 模型目录（name=id）、`agent-default-model {provider: relay}`、active 标签即时出现；模型表三计价 + 分组列 + 无名称列；能力保存落盘精确（其余字段未动）；↻ 拉取正确；手工添加/删除闭环；禁用 key 警告文案。
- 真实 home 升级验证（只读）：profile 重装为新包名后原连接/key/模型目录/默认模型照常。
- 单测 + typecheck 全绿；交付物专名审计零命中。

### 6. 遗留与已知限制

- 能力配置跟随条目；切换 key 会带走离开目录模型的能力配置。
- models.dev 为第三方快照；未收录模型/toggle 型推理依赖手动配置（↻ 有明确提示）。
- dev.js 启动会拉起系统默认浏览器（dsh 行为，未透传 --no-open）。
- 模型容量仍按 id 前缀启发式（未识别回退 131072/8192）；同步不冲手工修正。

---

## 2026-09-22（v0.4.0 后续 — 迁移移除、上架准备、文档脱敏）

用户 8 项要求：验证中文界面；**移除老配置自动迁移（插件未正式发布，无存量用户）**；调研插件市场上架要求并完善 README/CHANGELOG/截图；清理仓库残留、完善 package.json；worklog/spec 等文档脱敏并归置 `docs/`；精简注释；词汇规范化；首次 commit。

### 1. 移除老配置自动迁移

- 删除 `src/migration.ts`、`tests/migration.test.ts`、`constants.ts` 的 LEGACY_* 常量与 `index.ts` 的迁移调用；`currentSection()` 改为直读 `relay` namespace（`resolveSection(settings.get(NAMESPACE))`）。
- 理由：插件从未发布，不存在存量旧命名环境；迁移层（198 行 + 14 用例）是纯负担。真实 home 在 v0.4.0 升级时已完成一次性迁移，不受影响。
- README 升级章节删除；AGENTS/WORKLOG 同步更新。测试 71 → 57。

### 2. 市场调研结论（dsh-market / awesome-dsh-plugin）

- dsh-market 本体不是目录；**上架 = 向 awesome-dsh-plugin 注册表提 PR**（`data/plugins/<owner>__<repo>.yml`，一个文件即全部投稿，category 取 `model`；描述必须与代码核对、无营销词；`description.en` 必填、zh 可自带）。
- CI 核验：`dsh.bundle` manifest（我们已声明）、仓库满 1 天、awesome-lint、README 可再生。
- 截图：在自己仓库放 `screenshots.json`（1–8 张、仓库内相对路径）；README 图片会被市场自动抽取兜底；图片仅接受 GitHub 托管。
- npm 发布（推荐）：`repository` 字段必须指回收录仓库（自动建立 npm↔目录映射）；官方包一律 `peerDependencies` 且 peer 范围要带**显式预发布分支**；仓库加 `dsh-plugin` topic；市场卡片按 `engines.dsh` 或 lockstep peers 展示宿主要求。
- 详见 `docs/PUBLISHING.md`（发布与上架清单）。

### 3. 仓库与包配置

- `LICENSE`（MIT）、`CHANGELOG.md`（Keep a Changelog 格式，0.1.0–0.4.0）。
- package.json：schemastery 转 `peerDependencies`（官方包规范，dshmarket 同款）；`engines` 补 `dsh: ">=0.1.5-rc.2"`（市场宿主感知展示）；keywords 补 `dsh-plugin`/veloera/done-hub/中转站；`repository` 暂缺——GitHub 仓库地址未定，乱填会把 npm 包挂到错误仓库，发布前按 `docs/PUBLISHING.md` 补齐。
- `.gitignore` 清掉旧 CLI 时代的遗留条目。

### 4. 文档脱敏与归置

- `WORKLOG.md` → `docs/WORKLOG.md`、`SPEC-0.4.0.md` → `docs/SPEC-0.4.0.md`，去除真实面板地址、账号 ID、key 名称、余额、sk- 前缀、绝对路径、本地代理地址、本地参考仓库路径；AGENTS.md 同步脱敏（真实 home 概要、账号授权段、端口/路径细节全部泛化）。
- 新增 `docs/PUBLISHING.md`（发布与上架清单）。

### 5. 注释与词汇

- 全量过一遍 src/ 与 tests/：删除叙事性历史注释（「v0.4.0 教训」「R1 审计」等 SPEC 内部编号），只保留契约/约束注释；测试 describe 标题去掉任务书编号。
- 界面文案微调：「联网获取能力初值」→「从 models.dev 获取参考值」（标注数据来源，用词更通用）。

### 6. 验收

- `tsc --noEmit` 0 error；vitest 57/57；build 成功。
- 隔离 home + mock 面板浏览器走查：中英两种语言全流程通过；界面截图（mock 虚构数据）存 `assets/` 并嵌入 README。

---

## 2026-09-24（v0.5.0 任务书立项 — 未实施）

操作者下达七项改进需求（能力知识库与匹配规则、移除默认模型、账户行精简、key 增删改、数据看板、使用日志、UI 参照），本阶段只做实证调研与写任务书，不实施。交付 **`docs/SPEC-0.5.0.md`**。

### 为任务书核实的关键事实（实证面板只读探测 + 上游源码）

- **token CRUD**：`POST /api/token/` 该 fork 必填分组；`PUT /api/token/` 必须带 id；`DELETE /api/token/{id}` 存在；列表为 `{page,page_size,total,items}`。上游源码确认字段表与「整对象更新」语义。
- **日志**：`/api/log/self` 条目带独立列 `cache_read_tokens / cache_creation_tokens / reasoning_tokens / reasoning_effort`，首字耗时在 `other` JSON 串的 `frt`（毫秒）；分页同 token 列表。
- **stat**：`/api/log/self/stat` 支持可选 `start/end_timestamp` 窗口（不带参数 = 全量口径，与面板「累计消耗」对账一致）。
- **看板**：`/api/data/self` 返回裸数组小时桶 `{model_name, created_at, token_used, count, quota}`；面板只保留近期桶（7 天窗口实测稀疏）；`/api/user/self` 有 `quota / used_quota / request_count`，无累计 tokens 字段。
- **模型 id 匹配**：实证面板 78 个 id 中 71 个在 models.dev 精确命中；大小写归一化零增益；7 个未命中全是变体后缀型（`-tiered`、`-high`、`-0902` 日期、渠道命名）。规则定为「精确 → 剥一层（至多两层）尾部变体后缀再精确 → 放弃」。
- **models.dev** 条目含 `limit.context / limit.output`，可作知识库「默认上下文窗口」默认值来源。

### 决策要点（写进 SPEC）

- 能力真源移入插件 namespace（知识库 + 按 id 覆盖），路由条目能力字段变为派生状态；同步只写插件持有配置的字段，无配置 id 的手工字段不被触碰。
- 创建 key 的明文边界：`data.key` 宿主剥离、绝不回传浏览器；提供「创建并设为生效」走服务端凭据写入。
- 看板图表手写 SVG，零新增依赖；数据稀疏按常态空态设计。
- 默认模型管理整体移除（写入、决策、状态行、文案），`agent-default-model` namespace 本身不动。
- 真实账号写路径（key CRUD 验收）限定一次性 `dsh-temp-` 临时 key 三步闭环，既有 key 不碰。

---

## 2026-09-24/25（v0.5.0 — 能力知识库与匹配规则、移除默认模型、key 增删改、看板与日志、--no-open）

按 SPEC-0.5.0 无人值守实施七项需求。模块布局新增：`src/knowledge.ts`（知识库/覆盖类型、校验、匹配规则、落点重放的纯函数）、`src/usage.ts`（日志整形 + 看板按天聚合）；客户端新增 `dashboard.tsx`（recharts）与 `logs.tsx`，能力页重写为「知识库 + 平台模型」两段。

### 1. R1 能力语义重构

- 能力真源移入 `relay` namespace 的 `capabilityCatalog` / `capabilityOverrides`（schemastery dict，schema 必须声明否则 resolved 值读不回）；路由条目能力字段变为派生状态，`syncRouteCatalog` 与新的 `replayRouteCapabilities` 在一次修订守卫写内按「覆盖 → 知识库（剥后缀=近似）→ 不触碰」重放，只写插件持有配置的字段。
- v0.4.0 的 `applyCapabilityUpdates`/`saveCapabilities`/`capabilityOf` 整体删除（路由级手工增删模型不再提供，知识库承担该职责）。
- 匹配规则 `matchCatalogName`：精确 → 剥一至两层尾部变体段（标 approximate）→ 放弃；无模糊/大小写归一化。

### 2. R4 key 增删改的三个关键边界

- **明文剥离**：`createToken` 只返回 `{id,name}`；「创建并设为生效」在服务端走常规切换流程，明文只进凭据文件。
- **上游 UpdateToken 语义（联网读源码实证）**：`PUT /api/token/` 的 **status 只在 `?status_only=true` 时生效**，普通 PUT 更新 name/expired_time/remain_quota/unlimited_quota/model_limits*/allow_ips/group。初版把 status 放普通 PUT 里，真实面板实测「禁用不生效」——查上游 controller/token.go 后拆成两段写（普通编辑 + 可选 status_only PUT），mock 同步镜像该语义。
- 编辑必须以列表原始记录为基合并回传（整对象更新语义）。

### 3. R5/R6 看板与日志

- 宿主聚合：`/dashboard` 一次返回余额卡片 + 近 N 天按天按模型桶（hour 桶按本地日聚合、¥ 换算在宿主侧完成）；`/logs`、`/logs-stat`、`/logs-meta`（筛选下拉数据源）。
- 图表选 recharts（spec 基线）：**client 产物 2.21MB**（recharts + d3 家族全部打进产物；react/jsx-runtime/react-dom 外置——外壳 PLATFORM_MODULES 实测供给 react-dom）。两个构建期坑：① 浏览器模块表无 `process`，recharts 的 NODE_ENV 守卫需 tsdown `define` 消解，否则运行时报 `process is not defined`；② react-dom 外置后 react-is 仍需打包（基座无此键）。

### 4. R8 --no-open

`scripts/dev.js` 抽出 `parseDevArgs`（可单测），`--no-open` 透传 dsh web；AGENTS/README 开发小节同步。

### 5. 浏览器验收抓出的三个真 bug（全部修复 + 回归测试）

1. **空壳回写**：重放路径把 resolved 值里 schemastery 具体化的 `input: []` 原样写回 settings.yaml（AGENTS §4.1 教训的新变体）——写边界统一 `cleanModelEntry`。
2. **字典删除失效**：`settings.update` 深合并语义下，提交空 `capabilityOverrides:{}` 无法删除已有条目——改用 `mutate` 路径级 set 整体替换两个字典。
3. 重命名知识库行后编辑态丢失（editingName 存旧名）；知识库空态误复 intro 文案。

### 6. 验收证据（全部隔离环境 + 只读真实对账）

- 单测 96/96（匹配规则/落点重放/空壳清洗/日志整形/看板聚合/明文剥离/启停双模式/dev 旗标）；typecheck 0 error；build-shape 断言 client 的 bare require 只剩 react 系。
- 隔离 home（从零 add）+ mock 面板：中英双语六页签全走查；key 创建→编辑→启停→删除（含生效 key 删除警示）闭环；能力页知识库新增 + ↻ 拉取（含 contextWindow）+ 保存落盘精确断言（capabilityCatalog / 路由条目 input/reasoningEfforts/contextWindow）；覆盖编辑与清除；key 切换后知识库存活并重放到新目录；看板卡片与堆叠图口径切换；日志筛选/分页/`other` 容错。
- 真实账号只读对账：self/stat（窗口与全量）/日志字段/稀疏桶全部与面板一致，日志无 key 材料；匹配规则实测 82 个面板 id 命中 79（75 精确 + 4 近似），未命中 3 个全为渠道命名特有族。
- 真实面板写路径：一次性 `dsh-temp-` 前缀临时 key 走 创建（空分组被拒）/编辑（改名/减额/设过期/禁用）/删除 闭环，面板无残留；既有 key 未触碰。
- 截图 12 张（六页签 × 中英，mock 数据）重拍并更新 screenshots.json（6 张英文）。

### 7. 遗留

- v0.4.0 直接写在路由条目上的旧能力字段不会自动迁移进知识库（按 spec 语义保持原样，页面文案已说明）；用户可在能力页对相应 id 建覆盖接管。
- 看板图表未做 minify（client 2.21MB）；如需可后续加 tsdown minify（改动 build-shape 断言需同步）。

---

## 2026-09-24（v0.5.1 — 体验修订：行内编辑 / primitives / 预置知识库 / 完成即存）

需求（SPEC-0.5.1，调研先行）：R1 key 行内原地编辑（对齐官方 Models 页行↔卡）；R2 复用 dsh primitives + 宿主版本兼容策略；R3 看板四卡一行；R4 日志筛选两行布局 + 下拉占位文案修复；R5 能力页重构（预置知识库 + 统一刷新 + 1M/256K + 平台卡收起 + 完成即存 + /capabilities 改定向 ops）。

### 1. 宿主兼容调研结论（写进了 README/PUBLISHING/AGENTS）

- primitives 等浏览器模块**不经 npm**：宿主把冻结模块表（PLATFORM_MODULES，0.1.5-rc.2 起含 `dsh-client-ui-primitives`）里的自己那版编译产物供给插件 bundle 的裸 require；npm 侧无法表达「API ≥ X」→ 兼容 = engines.dsh 下限（>=0.1.5-rc.2）+ 稳定子集纪律 + 升级后浏览器走查。
- 跨 tag diff 实证（rc.2 → 0.1.7-rc.1）：本插件消费面 Switch/Pill/Tag/Button 零改动、Menu/Modal 纯增量、StateDot 一致——子集向后兼容。0.1.7 新增件（settings-form、SegmentedControl、Checkbox）不引入。
- 三方注册表（awesome-dsh-plugin，1000 条）抽查：社区无强兼容机制可抄，「engines 下限 + 稳定子集 + 冒烟」即正确姿势。
- **rolldown 对「未安装且 neverBundle」的包正确保留裸 require**（spec §11 风险落空）：tsdown CLIENT_EXTERNALS 加包名即可，无需 devDependency；类型最初用 `src/primitives.d.ts` 手写最小声明（props 按 submodule 源码）。**追加轮改用官方类型**：npm 线与 dsh 同班次锁步发布（`latest` 标签停在 rc.1 是 prerelease 不挪 tag 的语义，非未发版；`MenuItemButton` 在 0.1.5-rc.2 tarball 0 处、0.1.7-rc.1 3 处，实证内容随版本演进），devDependency 精确锁 `0.1.5-rc.2` 供类型、删手写 `.d.ts`——typecheck 直接过，产物字节不变；升级 dsh 时须锁步升级该包（PUBLISHING §6 已记）。

### 2. R5 预置知识库（编译期入库 + 运行时内存层）

- `src/knowledge-preset.ts` 纯逻辑（脚本与 /knowledge-refresh 路由共用）：主源 = 面板**公开** `/api/pricing` 的 model_name 经 `matchCatalogName`（与运行时同一规则）规范化；基源 = models.dev 白名单 provider（**api.json 实名核对**：`moonshotai`/`xai`/`zai`，spec 初稿的 moonshot/x-ai/z-ai 拼写不存在）；两源按名并集经 mapModelsDevEntry+mergeSuggestions（contextWindow 取最大）合成条目。
- `npm run preset:fetch`：先 build 出 `lib/preset-tools.js`（脚本无法直接 import src/*.ts——node type-stripping 不重写 .js 扩展名，改为消费构建产物，对 node 版本零依赖），再拉两源生成 `src/knowledge-preset.generated.ts`（入库；头部只有计数，无面板身份）。实跑：**283 条预置**（白名单 10/10），面板 82 ids → 命中 79、丢弃 3（grok-imagine/grok-video/gpt-image-2.5），宿主产物 72KB → 110KB。
- 运行时：knowledge.ts 加 `capabilityPreset` 层（用户同名覆盖预置；派生跑「用户 ∪ 预置」名集，source 增 preset/preset-approximate）；`POST /api/relay/knowledge-refresh` 用 `ModelsDevClient.refresh()`（绕 TTL、单飞、失败抛错可重试）+ 同一份并集逻辑重建**宿主内存**层（重启回落编译基线，设计使然）。浏览器实测刷新 263→267（mock 面板源把 deepseek-reasoner 经非白名单 provider 命中带入——panelOnlyNames 路径顺带验证）。

### 3. R5 定向 ops（/capabilities 契约变更）

- body 从整体字典改为 `{catalogSet, catalogDelete, overrideSet, overrideDelete}`；逐条转 `settings.mutate` 路径操作（寻址 `capabilityCatalog.<name>` 等——**删除真实生效**，v0.5.0「深合并下空字典删不掉」问题的根治）；一次 mutate 载全部 ops + 一次修订守卫重放。处理核心抽到 `src/capability-ops.ts`（FakeSettings 可测）。
- 客户端随之去掉批量 dirty/reconcile 机制（reconcileKbRows/reconcileOverrides 删除，相关测试重写为 capability-draft 纯函数测试）；草稿保留由「一次一张卡 + 提交即写」天然保证（刷新预置不清打开中的草稿实测通过）。

### 4. R1/R2/R3/R4 要点

- key 行↔卡：单一 openKey 状态、行内原地展开（一次一张）、应用即写（busy=保存中…）、失败卡不收 + 卡内透传面板错误、删除/清除一律 primitives Modal；启用/创建并生效用 primitives Switch（label 必填）。
- MenuSelect（`client/menu-select.tsx`）：LanguageRow 同款（锚点按钮 + 当前值 + chevron + `Menu` portal），全站唯一下拉实现；分组选择器与日志三筛选统一走它。**走查抓到自伤 bug：初版锚点漏写 onClick**（对照官方 LanguageRow 才定位——环境无问题）。
- 看板四卡：`repeat(4,minmax(0,1fr))` + 数值 16px + 内边距压缩（<480px 回落 2 列）；走查用 getBoundingClientRect 断言四卡同一 y。
- 日志筛选两行：时间范围独占一行（flex:1 + min-width:0）、三下拉 + 查询/重置第二行；占位文案按字段（全部模型/全部密钥/全部分组）。

### 5. 踩坑与决策记录

- **Escape 双关**：菜单开着按 Escape，primitives Menu 关菜单的同时**宿主设置面板也关**（SettingsPanel 在 document 层监听 Escape，官方 LanguageRow 同款）——上游设计，保持与官方一致，不改（AGENTS §4.6 记录）。
- **IAB 输入管线故障**：browser-use 走查中途 reload 后 IAB 对 CDP 输入全面无响应（trusted 事件到不了页面，官方 UI 同样点不动）——环境级故障。兜底：本机 Chrome headless（CDP 9223）+ 零依赖 WebSocket 直驱 `Input.dispatchMouseEvent` 完成全部走查与截图；`mock-relay.ts` 加 `port` 选项支持独立进程。此兜底路径已写进 AGENTS §6。
- 预置脚本读面板地址只解析 `.dsh-home/settings.yaml` 的 `relay.baseUrl` 一个字段（手写 mini 解析，不引依赖、不碰凭据）。
- `/api/relay/model-info` 路由保留（客户端逐行 ↻ 已删，宿主 API 面保留不破坏）；对应 locale 键清理。
- K=1024 约定与个别厂商十进制容量（200K=200000）有 2.4% 级偏差——实时换算 hint 让所见即所存（README 已知限制写明）。

### 6. 验收证据

- 单测 **117/117**（新增 parseContextWindow 矩阵/预置构建 fixture/定向 ops/refresh 语义；重写 capability-draft）；typecheck 0 error；build 三产物（index 110KB / client 2.23MB / preset-tools 14KB）；build-shape 白名单 + primitives 裸 require 断言。
- 浏览器（隔离 home 从零 add + mock 面板 + Chrome CDP）：中英 × 六页签全走查。关键断言：MenuSelect 开/选/外点关；key 行内编辑应用后行更新（分组 default→vip）+ status 通告；Modal 删除（3 行→2 行）；看板四卡同行；日志占位文案 + 筛选（gpt-4o-mini → 共 1 条）+ 重置；能力页平台卡收起（预置徽标 + vendor）、1M hint（`1M = 1,048,576`）、10M 拒绝、完成即存 → **settings.yaml 落盘**（override 262144 + reasoningEfforts 重放 + maxTokens/compat 保留）、清除覆盖后 capabilityOverrides 清空、知识库条目增删（dict 删除真实生效）、预置折叠区过滤（263→21）、刷新预置成功（267）、无全局保存按钮。
- 真实账号：只读对账 `/api/user/models` vs `/api/pricing` 双向零差集（82=82，预置主源等价性再确认）；`preset:fetch` 实跑（令牌零参与）；`dsh-temp-` 临时 key 创建→改名/减额→status_only 禁用（status=2 且 quota 保持）→删除，面板无残留，既有 key 未触碰。
- 截图 12 张重拍（六页签 × 中英，mock 虚构数据）入 assets；screenshots.json 不变（6 张英文）。

### 7. 遗留

- 刷新预置的**失败路径**在浏览器端未现场复现（当次 models.dev 直连恰好可达）：错误文案与可重试行为由单测（refresh 失败抛错）+ locale 键保证；后续走查可断网复验。
- IAB 输入管线故障原因未深究（疑似宿主 app 级状态）；CDP 兜底路径已文档化。

### 8. v0.5.1 追加轮（同日，操作者体验反馈六项）

1. **client 产物体积**：sourcemap 归因——recharts 及其依赖树（es-toolkit/redux toolkit/immer/decimal.js/reselect/redux/react-redux）占 ~78%，自身代码 19%。根因是 v0.5.0 起 client 产物从未 minify。tsdown client 配置加 `minify: true`：**2.23MB → 982KB（gzip 233KB）**。minify 会把引号规范成反引号、require 改名为形参——build-shape 的字符串断言全部失效，重写为 **vm 沙箱真实加载**：执行产物、捕获 `__ModuleLoader__.load` 定义、调 factory(fakeRequire)，断言 `apply/inject` 导出面与 require 白名单（恰好 react 系 + primitives，`react-dom/client` 被 tree-shake 不再请求）。
2. **预置 6 个月窗口**：models.dev 条目 100% 带 `release_date`（白名单 286/286），`buildPresetEntries` 加 `options.now` + `PRESET_MAX_AGE_DAYS=183`，同名取跨 provider 最新日期、无日期不合资格；测试 fixture 固定 now 保证确定性。实跑重生成：**283 → 98 条**，产物 42.9KB → 17.2KB。注意 `preset:fetch` 必须**收尾再 build 一次**（脚本在 build 之后才改 generated.ts，否则 lib/index.js 还是旧基线——浏览器首验即踩）。
3. **能力页三区原地展开**：页级单卡 `openCard={section,key}`（官方 `editing` 习语）；我的条目「新增」= 列表顶部建卡；预置行「编辑」= 原地展开复制卡（完成存为自定义条目）；平台行不变。按钮统一：行内编辑/删除一律 outline sm 右缘（与 keys 行一致、对齐官方 secondaryButton）；编辑卡页脚一律 outline 取消在左 + primary 在右；keys 页同步统一。刷新按钮移入预置折叠面板工具行。
4. **名称完整单行 + 匹配提示下移**：`.relay_capId` 强制 nowrap 且**不截断**（操作者反馈名称必须展示完全；去掉首版的 ellipsis），`.relay_capMatch` 允许换行、置于 `.relay_capNameCell`（id 上、`匹配：…` 下）；挤压量由摘要吸收（`-webkit-line-clamp:2` 两行钳制，真实环境最长 id `deepseek-v4-flash-vision-exp` 28 字符实测完整单行、摘要恰 2 行）。编辑卡页脚对齐官方 `editorActions`（`justify-content:flex-end`：取消+主按钮成组靠右，PlatformCard 的「清除覆盖」以 `margin-right:auto` 独占左侧）；预置工具行按钮 `flex:none+nowrap`（首版选择器 `.relay_presetToolbar .relay_button` 落空——primitives Button 不带 relay_ 类，「刷新预置」曾被压成竖排换行）。
5. **浏览器回归（mock）**：三区原地开/关、页级单卡互斥（disabled 态）、预置工具行在面板内、1M/256K hint、完成即存落盘 + 清除落盘、Modal 删除闭环全过；重拍 zh/en capabilities + keys 截图。真实账号的目标 key（隔离 home:3298）：切换同步 28 模型，平台行 28 条全部单行、匹配提示全部正确置下（24 预置 + 1 近似 + 3 未配置；vendor 徽标 DeepSeek/智谱/Moonshot/小米/MiniMax/阿里巴巴），真实覆盖写 1M 落盘断言 + 清除恢复全过。
6. **CDP 走查工具演进**：Chrome 153 对 `<details>` 折叠内容保留布局（rects 非零但不可命中）+ 设置对话框 position:fixed 使 offsetParent 恒 null + scrollIntoView 平滑滚动导致测量过期——clickText 最终形态 = elementFromPoint 全量评分（可选先滚动）+ 稳定点复验（350ms 沉降后重测并确认命中）。

### 9. 设置区导航图标（结论：宿主限制，插件侧无扩展点）

操作者反馈中转站与通用设置图标相同，希望独立图标。实证：设置导航图标由壳硬编码——`ui-settings-general/src/client/SettingsRoot.tsx` 的 `navIcon(id)` 只认 `models`/`agent-presets`/`plugins`（rc.2；0.1.7-rc.1 另加 `account`/`archived-sessions`），其余 id（含 `general` 与插件 id）一律回落齿轮；`settings.section` slot 契约（ui-settings/src/client/contract/slots.ts）仅声明 `id/order/label`，**没有 icon 位**。上游 GitHub Discussion #3162 同结论。可行路径：向上游提 PR 给 `navIcon` 加 relay 映射（建议用 rc.2 图标集自带的 `IconApiOutline14`，语义贴合中转站；注意 0.1.7 已整体换 Medium 系图标）。patch 建议文本与讨论链接已记 `docs/local.md`。插件侧不做投机字段（slot 加多余 icon 键宿主直接忽略，无当前效果）。

### 10. 公开文件脱敏复审（提交前）

操作者要求公开文档/文件不得出现历史专名、本地环境与账号信息。复审与处置：
- 命名审计哨兵的明文（AGENTS/SPEC-0.4.0/WORKLOG 叙述 + build-shape 测试 needle）全部中性化为「历史专名哨兵」，needle 在测试内拼接构造、不再自曝；审计 FILES 范围从 6 项扩到 14 项（覆盖 README.zh/CHANGELOG/AGENTS/WORKLOG/三份 SPEC/PUBLISHING），机制可持续守住。
- `tests/pricing.test.ts` 的 pricing fixture 的分组名（v0.5.0 起借用真实分组名、倍率同真实参数）改为中性 `budget`/0.6。
- WORKLOG 中真实 key 名改为「目标 key」。`docs/local.md` 为 gitignored 本机备忘，不受影响。
- 复验：`git grep` 全跟踪文件对专名/真实 key 名/用户 ID/面板地址/真实余额快照零命中（dashboard fixture 余额同步改值）；118/118 全绿。
