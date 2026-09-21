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

按 SPEC 无人值守实施四项需求。包名 → **`dsh-plugin-relay`**，namespace/route/keyRef/pi-ai 路由全部通用化（`relay` / `/api/relay/*` / `RELAY_API_KEY` / `relay`），交付物 `grep -ri relay` 零命中（tests/build-shape.test.ts 内置机械审计）。

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
