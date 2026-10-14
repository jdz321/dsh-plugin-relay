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

### 11. key 编辑器分组选项与名称回退（操作者反馈）

- 分组选项展示格式「分组名 倍率 (描述)」（如 claude-stable 0.65x (高智高缓，稳定)）：宿主 `/keys` 响应新增 `groupRatios`（pricing.groupRatio 过滤后透传），客户端 `groupOptionLabel`（format.ts，缺倍率/描述的分组自动省略对应段）；MenuSelect 锚点与选项同步该格式。mock（default 1x / vip 0.8x）与真实面板（claude-stable 0.65x，与操作者示例逐字一致）双验证。
- key 名称留空回退分组名：KeyCard.apply 内 `name = form.name.trim() || form.group.trim()`，回退值回填表单（失败卡保持时所见即所得）；分组为空时仍报「请选择分组」（此时名称无从回退）。keyFormError 签名改为接收生效 name/group。mock 验证：空名创建 → key 命名为所选分组；编辑态清空名称应用 → 回退为分组名。
- 新增 tests/format.test.ts（groupOptionLabel 矩阵）；121/121 全绿。

### 12. preset:fetch 管线简化（操作者反馈：build→fetch→build 两次 build 很怪）

根因：脚本消费 lib/preset-tools.js（先 build）；生成物变更需烘入 lib/index.js（再 build）。修复：新增 `scripts/ts-resolver.mjs`（`module.registerHooks` 把源码内部 `.js` 引用解析到 `.ts`，约 20 行，Node ≥22.18 类型剥离默认开启），脚本直接 import `../src/*.ts` 与运行时共享同一份 builder——脚本改为**纯 codegen**（只重写生成的源文件，不触发 build）：lib/ 是编译产物，产物同步走「改 src 后手动 build」的既有约定 / `prepublishOnly`（发布）/ CI 的 build 步骤，preset:fetch 不越权；删除 `src/preset-tools.ts` 与 tsdown 的 preset-tools 产物（build 从 3 产物回到 2 产物）。顺带把 `buildPresetEntries` 的 `dropped` 列表排序稳定化（此前随面板返回顺序抖动，generated.ts 会出现无意义的 diff）。验证：直跑产物与基线数据一致（97 条），121/121 全绿。约束：脚本需 Node ≥22.18（维护者本机环境，AGENTS §3 已注明）。

### 13. 每周基线漂移 workflow（操作者需求：定时执行 preset:fetch）

`.github/workflows/preset-refresh.yml`：每 7 天（cron 可改）跑 `preset:fetch`（纯 codegen、零 npm 依赖，CI 里无需 npm ci），diff 已提交基线：无漂移静默结束；有漂移 force-push `preset-refresh` 分支并开/更新 PR（含脚本输出），**不自动合并**，发布链路独立（tag 触发）。CI 无面板源 → 白名单口径；v0.5.1 面板源基线在位期间 PR 会含面板派生条目的移除（PR 正文已注明），SPEC-0.6.0 落地后收敛为纯 models.dev 漂移。

---


---

## 2026-09-28（v0.6.1 — 折叠面板、预置增量层、双轴图表）

### 0. 概览

按 docs/SPEC-0.6.1.md 实施六组需求（R1 连接 tab 折叠面板重构 + §3.3 样式修复、R2 预置刷新持久化增量层、R3 图表双轴/Top-N、R4 删除 Modal 增强、R5 覆盖率分段过滤、R6 工程项），中英两遍走查 + 落盘/rect/describe 断言 + 真实账号只读验证全部通过。client 产物 ~104KB（350KB 断言内），单测 210 全绿。

### 1. R1 折叠面板（最大 UI 变量）

- `panel-detail.tsx` git mv 为 `panel-body.tsx`（去返回按钮，头部 = 状态行 + 测试连接 + 删除 outline），四个 tab 组件零改动（spec §2 预判成立——风险集中在 section/panels-tab 状态提升）。
- `openPanelId` 语义从「进入二级页」改为「展开哪个折叠项」；caps 刷新 effect 依赖不变（revision + openPanelId），v0.6.0 修过的「切 key 后平台区过期」未回归（走查实证）。
- 编辑链路整体移除：`panels-update` 路由、`updatePanel`、client edit 分支；spec 指出「名称创建后不可改的约束自然消失——因为根本没有改」，实际连带删掉了 `panelFormError` 的 edit 分支与 `tokenPlaceholderSet` 文案。
- **§3.3 样式修复实证**：`.relay_head button{white-space:nowrap}` 并入既有分组选择器；新增卡标签缩短为词组 + 说明下沉 `relay_capHint`（中英各四个 hint 键）；rect 断言两列输入框 top 426/426、530/530 全对齐。
- **/panels 秒回 + account 懒加载**：`panelSummaries()` 纯函数（panels.ts，relay/pi-ai/default-model 三视图入参，`routeModelsCount` 注入）返回纯配置态 + `overrideCount`/`defaultModelTarget`；`AccountCache`（account.ts）5s TTL、失败同缓存；真实面板实测列表秒回、账户行 ~3.5s 后行内填充（不可达面板不阻塞）。

### 2. R2 预置增量层

- 数据模型 `capabilityPresetDelta = {builtAt, removed[], changed{}}`（SectionSchema 新键，dict(CapabilityEntrySchema)）；`resolvePreset/diffPreset/normalizePresetDelta/summarizePresetDelta` 全在 knowledge.ts（diff 用 canonical JSON 比较，键序无关）。
- 刷新 = 先 `mutate` 落盘 delta（await 完才返回，竞态红线）→ `resolvedKnowledge()`（读 raw section 的 delta，规避 schemastery `{}` 壳）→ 逐面板重放；`runtimePreset` 内存变量删除。「刷新预置」与「恢复基线」（`POST /api/relay/preset-restore`，Modal 确认 → unset → 重放）共用 refresh.ts。
- 走查全链路：基线 140 → 刷新 142（+2/−0，9-28）→ settings.yaml 精确断言（builtAt/removed/changed 结构）→ **dsh 进程重启后增量仍在**（换新编译基线 142 后 delta 依旧叠加——spec §11 预判的叠加语义实证）→ 恢复基线 → 落盘断言 delta 键消失。
- 注意：SectionSchema 的 schemastery resolved 值会把缺省 dict 具体化为 `{}`，`normalizePresetDelta({})` 返回 undefined——「无 delta」判定天然正确。

### 3. R3/R4/R5

- 双轴：`linePath/linePoints` 纯函数（band 中心取点、负值钳 0）；右轴独立 niceScale + tokenCountText 刻度；折线 `<circle>` 带 `<title>`；图例加「Token 总量（右轴）」静态条目。几何断言：右轴 0/1.95k/3.91k/5.86k 无重叠，全部文字与折线 bounding box 在 SVG 界内（视觉模型对截图的「折线越界」告警系裁切误报，DOM 几何复核推翻）。
- Top-N：`topSeries`（窗口总额排序、并列按名字升序稳定）+ `OTHERS_KEY='__others__'` 合并列；图例「其他」不可点（span 非 button）；9 模型 mock（mock-relay.ts 加 `extraBuckets` 选项）实证 7 彩 + Other 5 + 8 种填充色。纯函数与 pivotBuckets 挪进 dashboard-chart.tsx——vitest 无法加载 primitives 的 CSS 导入，测试文件只 import 无 react 依赖的模块。
- 删除 Modal：警告行走 Modal 的 `children`（ReactNode 通道），`description` 保持 string（primitives 类型如此）；`defaultModelTarget` 读 `agent-default-model.provider`。走查实证三行齐现；注意 panels 响应是 revision 驱动的——RPC 直写 agent-default-model 后需刷新页面才出现警告（正常 UI 操作会带 revision bump，无实际影响）。
- 覆盖率分段：四个 `relay_capFilterSeg` 按钮替代纯文本（`{panelId, source}` 单一 state）；切/换/清三态走查全过；顺手把 en 行硬编码的全角「：」改为 locale 键 `capCoverageColon`。

### 4. R6 工程项

- **渠道去重 Set 化**：`strippedUsed` Set 替代 `[...finalNameOf.values()].includes()`；回归 = preset:fetch 重跑，产物 diff 仅日期头 + models.dev 当日新增 2 条（gpt-daybreak-*），去重计数 22/16/131/23 与旧基线全等。
- **IAB 输入管线排查（翻案）**：document 捕获监听记录 pointerdown/click/keydown（clientX/Y、target、isTrusted），三组实验：①Playwright locator 点 Continue——完整 trusted 事件序列落在按钮中心 (852,486)，对话框关闭；②设置对话框内 locator 点 Relay——同上，区块切换成功；③cua 坐标点「+ Add panel」——trusted 序列落点 (956,340)，create 卡展开。**结论：0.6.0 的「dsh 拦截 locator/IAB 事件」不复现**；本会话唯一可复现的失败是（a）未关闭的删除 Modal 遮罩（`_mask_` aria-hidden）导致 actionability 判定 covered-by-mask——属正常遮挡非拦截，（b）IAB `fill('')` 空串不改 DOM（值原样保留），清空输入需原生 setter + input 事件（工具层怪癖，已记 AGENTS §6）。0.6.0 当时现象归因：宿主版本临时缺陷 + 遮遮挡混杂误判。**标准走查路径回归 IAB 优先**，CDP（tests/walkthrough/cdp.mjs）用于截图与脚本化。
- **RPC envelope 逆向定案**：宿主侧 `packages/api/gateway/src/index.ts` `remoteRequest()` 要求 payload 恰好一个 plain-object `args` 字段；envelope `{type:'client-request', rpcId, method, payload:{args}}`（`packages/client/connection/src/rpc-schema.ts` zod）；settings-controller `namespaceView()` 把 secrets 投影为 `{path[], set}` sidecar。走查直接 fetch describe：relay 视图 `valueHasTokenPlaintext=false`、`anySkPrefix=false`、`secretPaths=[panels.mocka.accessToken, panels.topn.accessToken]`（均 set:true）——替代 0.6.0 五重证据链的直接集成断言成立。
- **走查/截图脚本入库**：`tests/walkthrough/cdp.mjs`（零依赖 CDP：eval awaitPromise/click 先 instant 滚动+elementFromPoint 校验再 Input.dispatchMouseEvent、miss 落 domClick 兜底/shot；launchChrome 私有 user-data-dir）+ `shot.mjs` + README（含 why-CDP 与约定）；不进 npm pack files。

### 5. 真实账号只读验证（隔离 home，真实 home 零写入）

- 真实面板配置**文本级**复制进 `.tmp/wt-home`（凭据同样；隔离 home 0600 保持），懒加载实测、连接测试 OK、Use 真实 key（写路径只落隔离 home）：同步 11 模型 **全 L0 精确命中**（claude-fable-5 / opus-4-5→4-8 / opus-5、5-5 / sonnet-4-6、5 等），真实刷新预置 143 条（delta +1/−1）。验证后隔离 home 内的真实面板条目与凭据已清除；真实 home 只读未动（settings.yaml 无 capabilityPresetDelta、panels 原样）。
- **教训（PyYAML 毁键）**：用 Python yaml 往返 dsh 手写的 settings.yaml 会把 YAML 1.1 布尔键 `off:` 解析成 `False` 写回 `'False'`，pi-ai 严格校验拒绝 → **整个 llm-pi-ai namespace 拒绝注册**（表现：`settings namespace "llm-pi-ai" is not registered`，catalogWarning 提示但模型列表照常返回）。修复 = 以 dsh 原文文本级操作（不经过任何 YAML 解析器）。另：本会话曾把同一面板条目重复插入三次导致 DUPLICATE_KEY 拒载——文本级操作务必幂等。
- **dsh 语言偏好**：`locale.preference` 服务端持久化（settings.yaml）；headless Chrome（zh-CN accept-language）无存储偏好时，壳在异步采纳浏览器语言前插件区可能短暂按 en 渲染——走查截图前先在语言菜单点一次目标语言（`force-lang.mjs` 流程），之后稳定。

### 6. 质量门与收尾

- typecheck / vitest 210 / build 全绿；client 104KB ≤350KB；哨兵审计零命中（SPEC-0.6.1 加入 FILES 清单）；npm pack 只含 lib + cordis.patch.yml + README + CHANGELOG。
- 截图 6 张 × 中英重拍（1440×913）：手风琴折叠态（connection）、展开 keys、模型三计价、双轴+Top-N 看板、日志两行筛选、能力页（增量状态行）；screenshots.json 清单未变。
- 已知小改进（未做）：面板列表懒加载账户行在 revision bump 时会整组重拉（宿主 5s 缓存兜底，实际无风暴）；删除 Modal 的 defaultModelTarget 在 RPC 直写场景需刷新页面（UI 正常操作不受影响）。
\n## 2026-09-28（v0.6.0 — 多套中转站 + 主流预置基线 + maxTokens + SVG 图表）

> 按 docs/SPEC-0.6.0.md 实施（R1-R7 全部落地）。本条目只记研究结论、关键决策与偏离；逐条验收见 SPEC §12 DoD。

### 1. 预置基线：主流口径的三个实现层决策

- **白名单清单不静态存档**：spec §2.3 提到「316 规范名清单已存档 docs/local.md」，实际 local.md 未存（清单即规则：16 个第一方 provider 键 + 窗口 + 双信号剔除 + 去重）。实现直接以 `PRESET_PROVIDERS`（16 键，比 v0.5.1 的 10 键补齐 `-cn` 镜像与 xiaomi）为编译期清单，316 名由脚本从 live 数据推导——规则归一，避免两份清单漂移。
- **发布日期只取第一方条目**（重要修正）：最初「跨全 provider 取最新 release_date」会被渠道脏数据污染——实测 aggregator 里 `gemini-2.5-pro` 标 `2026-01`、`gpt-oss` 标 `1970-01-01`，导致 spec 明示「出窗」的 gemini-2.5 系错误入册。改为白名单名只信第一方条目日期；全 provider 日期只兜 OpenRouter 注入名（无第一方条目可用）。修正后 140 条，与 spec ~145 的口径一致（差异 = live 数据漂移）。
- **rekey 数据随迁**：建议/模态/日期三张映射最初按原始名索引、条目循环按最终名查找，rekey 条目（如 google-vertex 的 `xai/grok-4.20-reasoning`）会静默丢失——实测暴露后把三张映射统一 collapse 到最终名。

### 2. 匹配层级 L0-L5

- approximate 值语义从「剥层数」改为「层级号」（L1=1…L5=5）：下游只区分 exact/approximate，语义更准。strip 回归保持（v0.5.1 用例全绿）。
- L3 双向互换在「双形态同时收录」时不会误配：面板 id 变换后先走 L0 精确、再走 L1 折叠唯一性，歧义自动放弃（用例覆盖）。
- 真实面板对账（只读）：**67/83 命中，与 spec 预估分毫不差**；miss 16 = 图像视频 10 + gemini-2.5 系 3 + 渠道形态 2 + gemini-3-pro-preview 1（基线只有带日期戳形态）。近似命中 11 个（L1 casefold 5 + L3 版本分隔 + L4 变体补全 + L5 别名等）。

### 3. 多面板：嵌套 secret 的脱敏验证路径

- 子代理通读宿主源码实证：redact walker 对 `dict → object → role('secret')` 全覆盖（`packages/settings/settings/src/redact.ts` dict case 递归 inner，path 携带 dict 键；redact.spec.ts 有同构用例）——脱敏方式是**字段整体移除**（非掩码），`secrets` sidecar 记录 `{path, set}`。据此放弃回退方案（令牌迁移凭据引用），嵌套 secret 直存。
- 红线落实：panels 内 accessToken **不设 default 不设 required**（README 的 schema envelope 会把 default 发给每个客户端、required 会在客户端 decode 脱敏值时失败——宿主 README 明文警告）；宿主进程内 `get()` 不脱敏（owner 语义），wire 面（settings-controller 全部 @Remote）强制 `redactSecrets: true`。
- 走查实证：settings.yaml 落盘含明文（存储层，0600）；`/api/relay/panels` 与自建路由零泄漏；编辑卡 write-only（value 空 + 「已设置，留空保持不变」占位）；RPC envelope 的 describe 直接逆向成本过高，脱敏正确性由「宿主 redact 源码 + redact.spec + 本插件 schema 形状断言（build-shape）+ wire 面板路由零泄漏 + 编辑卡行为」五重证据链闭合。
- **客户端写面板令牌不走 settingsScope**：面板 CRUD 全部走自建 `/api/relay/panels-*` 路由（宿主侧 mutate path ops），绕开 scope.set 只支持单段 path 的限制，也让「keyRef 生成去重」「id 唯一性」在宿主单点收口。

### 4. 面板 id 与操作者 home 的迁移

- 面板 id 即路由键与提供方名。操作者真实 home 的 `agent-default-model.provider: relay` 与 `apiKeyEnv: RELAY_API_KEY` 依赖路由键 `relay`——迁移时面板 id 取 **`relay`**（恰好合法），agent-default-model、凭据解析路径、`.credentials.yaml` 全部零改动。改名需求 = 删除重建（UI 文案已注明）。
- settings.yaml 改写清单（已授权，0600 保持）：`relay:` 平铺连接字段 → `relay.panels.relay`（id/baseUrl/relayKind/accessToken 原值/userId/keyRef 显式 RELAY_API_KEY/selectedKeyName 原值）+ 空壳 `capabilityCatalog/Overrides: {}`；`llm-pi-ai.providers.relay` 增 `displayName: relay`（路由键不变，模型条目原样）；其余 section 未动。

### 5. SVG 图表

- 布局数学抽纯函数（niceScale/xLabelIndices/stackedColumns）vitest 直测；Y 轴 1-2-5 步进，**spec 说「整数刻度」——实现允许 sub-1 数据走 0.25/0.5 小数步**（mock 面板日消耗 ¥0.02 量级，整数轴下完全不可读），≥1 恒为整数，偏离已记录。
- tokenCountText 改 1024 基（spec §8.3 明确 1048576→1M；原实现十进制会显示 1.05M）。旧图 Y 轴 TPM/Token 显示随之变化（45000 → 43.95k）。
- recharts 移除后 client 产物 983KB → **95KB**；build-shape 新增 ≤350KB 断言防回退；client 构建的 `process.env.NODE_ENV` define 一并删除（无依赖树再需要）。

### 6. 走查中修掉的真缺陷

- 能力页 caps 数据只在挂载时拉取：在二级页切 key（建路由）后返回主页，平台模型区会显示过期的「未配置」——refreshCaps 依赖补 `snapshot.revision` 与 `openPanelId`。
- 覆盖 ops 删空后面板组残留 `{}` 空壳——applyCapabilityOps 增加「unset 后组为空则连组 unset」收尾（顶层 dict 的 `{}` 是 schema 既定语义，保留）。

### 7. 走查环境备忘（后人少踩坑）

- 本轮 IAB 输入管线失效（四种输入方式都打不进 dsh 对话框），按 AGENTS §6 兜底走本机 Chrome headless + `ws` CDP 直驱：**`Runtime.evaluate` 里 DOM `.click()` / React 原生 setter 是唯一稳定路径**（Playwright locator 与 CUA 坐标都被对话框拦截）；脚本要点后验证再重试（点击会被吞）；ws 连接不关 node 不退出（每脚本 process.exit）。
- 刷新预置实测通过（140 条 + 「并同步到模型目录」）；连接测试四态（正常/坏 token/坏 userId/死端口）文案全部按设计命中。

---

## 2026-10-13（v0.7.0 — 宿主升级 dsh ≥0.2.1-alpha.2）

任务：升级 dsh 到 0.2.1-alpha.2 并适配（不兼容旧宿主、不做旧插件数据迁移），插件版本 0.7.0。

### 1. 0.2.x 配置模型逆向（本轮核心认知）

- **settings namespace 没有了**：`SettingsForms` 服务（`ctx.settings`）按 composition entry id 寻址，`installSection`/`get`/`section`/`replace 之外的一切旧面`全部移除；用户层从 `settings.yaml` 变成 **profile patch 文档**（`profiles/<name>/cordis.patch.yml`），宿主启动时把旧 settings.yaml 一次性导入并改名 `.imported`。
- **可写性 = schema `.volatile()`**（schemastery 3.18.5-alpha.1 新原语）：`update/mutate/replace` 只允许写 volatile 字段之下的路径，否则 `Config field … is not volatile`；describe() 只投影 volatile 字段。pi-ai 的 `providers`、agent-default-model 的全部字段宿主侧已 volatile。
- **volatile 写不重启 fiber**：`configEditor.edit` → loader 对比 raw，volatile-only 差异 → `fiber._config` 原地替换 + cell 原地 `updateVolatile` + 本 fiber `loader/volatile-update` 事件；有普通字段差异才走 fiber 重载。pi-ai 靠同一事件热重注册路由（`config.providers.get()` 是官方消费范式）。
- **事件流**：`settings/document-updated(ns, rev)` 在根上下文 emit（无 thisArg → 全局监听可见，实测本插件 ctx.on 能收到）；`loader/volatile-update` 带 fiber 过滤的 thisArg，只有该 fiber 收到。
- **mutate unset 语义变化**：base 层同路径有值时 unset 退化为「重置为 base」。llm-pi-ai 与 relay 的 composition base 均为空配置，unset 即真删（panels 覆盖组清理、unsetRoute 均实测真删）。
- **RPC envelope 不变**：`{type:'client-request', rpcId(字符串), method, payload:{args}}` 依旧；`settings/describe` 无参数，响应 `result.value = {writable, hasDocument, namespaces:[…]}`，每 ns 带 `{value, user, secrets, autoGenerate, revision}`。`settings/mutate` 走 `{args:{ns, ops, expectedRevision?}}`。
- schemastery 依旧把缺省数组/dict 具体化为 `[]`/`{}` 壳（volatile cell 内同样）——`normalizePresetDelta` 的壳检测继续有效，无需新防御。

### 2. 插件侧适配

- `src/index.ts`：Config 四个顶层字段 `.volatile()`；`apply(ctx, config)` 收 cells；`settings.configure({auto:false}, ctx.fiber)` 关宿主自动页；entry id 从 `ctx.fiber.entry.options.id` 读（回落 `relay`）；路由镜像改由 `loader/volatile-update` 驱动。
- `src/store.ts`（新）：`PluginStore` 把新宿主服务包成旧 `get/section/update/mutate/describe` 门面——own ns 读 cell（免费且恒新），外部 ns 读 describe 视图按 entry 缓存、`settings/document-updated` 失效。**内部模块（route-config/capability-ops/panels-ops/refresh/plan）零改动**，tests/fake-settings 直接实现同一门面，210 个单测原样通过。
- 客户端：页面从 `settings.section`（web 设置页）迁到 **Plugins 面板的 `plugins.item` slot**，`configForms.whileServed(['relay'], …)` 守护注册（ns 不服务时自动摘除）；组件按 `view: 'summary'|'page'` 双渲染（列表卡/详情头一行摘要 = 「N 个中转站 · 已同步 N 个模型」，page = 原两 tab UI）；状态快照从旧 `settingsScope` 换成 `configForms.get('relay')`（同一控制器被 plugin-manager 共享）。**不声明 slot 的 `locale:` 字段**——框架 t 是 `(key, params)=>string` 约束，与本插件「字典值为函数」的翻译器冲突；t 仍由 inject 传递。
- `package.json`：dsh 与 primitives 精确锁 0.2.1-alpha.2；**schemastery peer/dev 锁 `~3.18.5-alpha.1`**（`.volatile()` 构建期方法——3.18.2 没有它，宿主若把 peer 解析到旧版会在模块加载时崩，故放弃 `^3.18.2`）；`engines.dsh >=0.2.1-alpha.2`；`dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-plugin-manager`（plugins.item 宿主）。

### 3. 实测（隔离 home，全绿）

- 面板 CRUD（volatile 写 → profile patch 落盘 → cell 热更新 → /panels 秒回）；/use 写凭据 + 建 pi-ai 路由（能力推导 claude text/image + reasoningEfforts 全对）；模型同步、能力 ops（覆盖增删 + 空组清理）、连接测试、看板（SVG）、日志、刷新预置（147 条、delta +11/+12/−6 落盘 + 全面板重放）、删除清理（patch 文档零残留、凭据引用 unset）、**重启后 delta 仍在**。
- **profile patch 写出的 `reasoningEfforts.off: null` 完好**——0.2.x 写入走 js-yaml（YAML 1.2 core schema），v0.6.1 的 PyYAML 教训不适用于新写路径。
- 浏览器走查（cdp.mjs 脚本化，中英各一遍）**17/17**：relay 卡片 summary 单行、详情页两 tab、UI 建面板、手风琴、四子 tab、Use 后 active 标签、看板 SVG、能力页预置/平台卡、DOM 零 sk-/令牌明文、删除 Modal「将一并清理」、英文页（经 `settings/mutate` RPC 写 `locale.preference: en` 后 reload）。describe 脱敏直断：wire value 无令牌、`secrets` sidecar 精确报 `panels.<id>.accessToken`。
- primitives 实证：Button/Switch/Pill/Tag/StateDot/Menu/Modal props 不变；图标全家改名 `*Outline14/16 → *OutlineMedium/Regular`（本插件只用 `IconChevronDownOutlineMedium`）；新增 SettingsForm 族未消费。
- 走查脚本坑（同 v0.6.1）：cdp.mjs 的 `open` 不退出（ws 保持事件循环）——本轮改为单脚本 `withChrome` 全程驱动；子 tab 与顶层 tab 文案重叠（「模型」⊂「模型能力」），点击必须按 `.relay_panelBody` 作用域 + 精确文本。

### 4. 文档同步

- AGENTS.md §1/§4.1/§4.3/§4.5/§4.6/§6/§8 重写为新模型；README/README.zh 更新宿主要求与入口（设置页 → 「插件」面板）；CHANGELOG 0.7.0。

### 5. v0.7.0 追修（同日）：页面入口与宽度

- **入口迁移**：首版把页面注册到 `plugins.item`——那是 plugin-manager「官方」分组的 items 列表（host-plane 插件如 web-search/subagent 的家），第三方 npm 插件挂上去会以卡片混进官方分组。改为 **`plugins.bundle.config`（keyed slot，`key: CLIENT_MODULE_ID`）**：页面渲染在「已安装」分组里 `dsh-plugin-relay` 包详情页的配置区（`configured = ledger.bundles.has(pkg.name)` 时才渲染，`renderSlot` 传 `{view:'page', entryKey: 包名}`）。实测：官方 17 项无中转站卡，已安装 1 项进详情即见完整两 tab 页面。
- **宽度自适应**：`relay_section` 沿用旧设置页的 `max-width:760px` 导致设置区比详情页其它内容窄——已删，设置区与包描述/组件区等宽（实测均 960px）。
- **截图重拍**：assets/ 12 张（6 页 × 中英）全部在 0.2.1 壳上重拍（1440 宽、设置区域垂直居中取景、超高区域顶部对齐；clip 裁在「包含的组件/Components」上沿，避免带入包详情「来源信息」的本机路径）。**走查工具换用 ZCode 自带 browser-use（IAB 后端）全程驱动**：locator/snapshot/evaluate/截图全链路稳定，`settings/mutate` RPC 写 `locale.preference` 切语言；cdp.mjs 保留作脚本化备用。AGENTS §4.5/§6 已同步。

---

## 2026-10-14（v0.7.1 — 预置改运行时获取 + 宿主存储栈持久化）

任务书：docs/SPEC-0.7.1.md（持久化方案经操作者复审修订后定稿）。删掉整条编译期预置链路，改为插件运行时从 models.dev 获取同一主流口径，持久化在 dsh 存储栈，默认每 24h 自动刷新。

### 1. storage 栈实证（安装树与 submodule 双核对一致）

- dsh-base patch（170-184 行）挂 `storage`（hub）/`storage-json`（后端，唯一配置 `root: dshHomePath('storages')`）/`storage-domain` 三行，是**每个 base-backed profile 的共享核心**；`session-projection-cache` 与 workspace 是现成消费者。
- json 后端语义逐条核实：`single` 布局每 unit 一个 `<root>/<unit>.json`（pretty JSON + 尾换行）；写 = 临时文件 + fsync + 原子 rename + 父目录 fsync；root 按需建 `0o700`、文件 `0o600`（实测一致）；**读严格版本匹配**（stamp ≠ descriptor.version 拒 `version-mismatch`，坏文件拒 `malformed-medium`）→ descriptor **version 恒 1 不翻动**；同一 unit 名二次 open 拒绝（句柄 open 一次复用，`preset-store.ts` 串行化 open）；unit 不串行化并发写（本插件单飞链保证至多一条写链）。
- 服务键：`storageBackendServiceKey('json') === 'storage.backend.json'`，由后端 `ctx.provide` 提供——`ctx.inject(['storage', 'storage.backend.json'], …)` 即「hub 与后端都就绪才回调」，无注册竞速。
- `@deepseek-ai/dsh-storage` 零 dependencies（仅 cordis peer），按 peer + devDependency（精确 `0.2.1-alpha.2`）引入，tsdown `HOST_EXTERNALS` + build-shape externals 断言同步；运行时零 dependencies 保持。隔离 home link 安装实测：peer 经仓库 node_modules 解析无碍。

### 2. `ctx.setInterval` 验证结论（spec §2/§9 要求入 WORKLOG）

- cordis-plugin-timer 确实由 dsh-base **无条件挂载**（patch 第 24 行），把 `interval`/`setInterval`（deprecated 别名）mixin 到 Context 原型；但 **0.2.1-alpha.2 实测：未 `inject(['timer'])` 的 fiber 上属性直取直接抛错** `cannot get property "timer" without inject`（mixin accessor 对未注入服务是 throw 而非返回 undefined）。
- 首版 `startInterval` 用 `typeof ctx.interval === 'function'` 守卫——守卫本身来不及生效，走查当场炸出 `settingsRegistrationError`（settings inject 回调中断：store 与事件监听已建好、面板功能未损，但 ticker 没挂上）。修复：try/catch 内**成员调用**探测（成员调用保持 mixin 的 this 绑定，裸函数引用会丢 fiber），失败降级 `ctx.effect(() => { const t = setInterval(…); return () => clearInterval(t) })` 自管——行为等价（timer 的 `interval()` 本身就是 effect 包的 setInterval），随 fiber 卸载自清。
- 结论：**宿主透传不可直接用，降级方案即正式方案**；types.ts 与 AGENTS §4.7 已按实证改写。

### 3. 实现要点

- `src/preset-store.ts`（新）：`PresetCache = {fetchedAt, entries}`；`normalizePresetCache`（非对象/缺 entries/坏 fetchedAt → null）；`StoragePresetCacheStore` 生产实现（open 一次复用；load 吞 open/读失败 → null + warn 点名 `relay_preset.json` 可手工删除重置；save 透传 `setGlobal`、open 失败上抛由调用方 warn；close 幂等）。
- `src/refresh.ts` 重写为 `PresetRuntime`：**内存层同步纯读**（`effectivePreset()` 绝不联网）；三触发面（启动检查 = settings+storage 双就绪后调度，存储缺失 10s 宽限降级内存层并照常跑检查；1h 到期巡检 `startInterval`；手动路由绕过到期判定）共享一条**单飞链**；`isCacheStale`（`now - fetchedAt ≥ 24h`，边界含等号）；链内顺序 = 取数 → build → 更新内存层 → await save（失败仅 warn）→ 内容有变才逐面板重放；失败路径记 `presetMeta.lastError`、成功即清。
- index.ts：config schema 回**三顶层字段**；`preset-restore` 路由删除；`knowledge-refresh` 响应 `{ok,count,fetchedAt,replayed,replayError?}`；capabilities GET 增 `presetMeta:{count,fetchedAt?,lastError?}`；storage inject 装配 + effect 卸载 dispose（关 unit/停 timer/清宽限定时器）。
- 删除：`knowledge-preset.generated.ts`（147 条/55KB）、`fetch-knowledge-preset.mjs`、`ts-resolver.mjs`、`preset-refresh.yml`、`preset:fetch` script、OpenRouter 兜底（`openrouterCanonicalNames` + `openrouterNames` 入参与 releasedAtAny 全链）。
- 客户端：预置区三态状态行（缓存「本地缓存 N 条 · 更新于 M-DD」/ 空态「尚未获取——联网后自动获取…」+ lastError 追加「上次更新失败（原因），将自动重试」）；恢复基线按钮/Modal/9 个 locale 键删除；介绍文案改写。**偏离说明**：spec §5.2 的失败提示带「（M-DD · 原因摘要）」日期，但 §5.1 的 presetMeta 形状无失败时间戳字段——按 §5.1 契约实现为不带日期（避免误导性的日期借用）。

### 4. 走查实测（隔离 home + mock 面板，0.2.1-alpha.2，中英各一轮）

- **落盘**：`<home>/storages/relay_preset.json` 实测形状 `{unit:{name:'relay_preset',version:1}, global:{fetchedAt, entries}, tables:{}}`，0600/目录 0700；profile patch 只写 panels/pi-ai 路由，**零 preset 字段进 settings**。
- **重启保留 + 24h 免重取**：重启后 fetchedAt 逐位不变（1791953002567）、148 条原样（hydrate 自介质，未再取数）；**删除介质重启重建**：open 视为空 unit → 启动检查立即取数，新 fetchedAt + 文件重出。
- **启动检查实证**：全新 home 首启（无任何手动操作）即完成获取落盘——settings+storage 双就绪触发。
- **旧 delta 惰性**：向 profile patch 植入 `capabilityPresetDelta`（0.7.0 形状）重启——无加载错误（settingsRegistrationError null）、describe 只投影三字段、残留 delta 的 `old-model` 条目不混入预置层。
- **失败路径**：死代理（`https_proxy=http://127.0.0.1:9`）+ 无介质 → presetMeta `{count:0, lastError:"proxy CONNECT failed…"}`，页面空态 + 失败追加提示；手动刷新 502 + 可读错误。恢复代理重启后自愈。
- **免重放**：内容未变的手动刷新 fetchedAt 翻新落盘、`replayed:true` 且无重放错误（skip 分支单测断言 settings 写次数为 0）。
- **手动刷新路由**：`{ok:true,count:148,fetchedAt,replayed:true}`，无 delta 字段。
- **describe 脱敏**：relay 视图零令牌明文；secrets sidecar 含 `panels.mock.accessToken`（0.6.1 RPC envelope 定案沿用）。
- **回归**：面板手风琴/账户行懒加载/keys Use（6 模型同步，`kimi-k3` 路由条目带完整派生能力、`reasoningEfforts.off:null` 完好）/模型三计价/看板双轴 SVG/日志筛选；能力页匹配徽标（mock 6 模型 coverage 预置 1 · 知识库 0 · 覆盖 0 · 未配置 5；`kimi-k3` L0 命中）、覆盖率分段点击过滤（切 1 行/清 6 行）、maxTokens 32K 覆盖完成即存（patch 落 32768）→ 清除回落。
- **截图**：能力页中英各 1 张按 0.7.0 配方重拍（1440 宽、暗色、设置区居中、裁 Components 上沿；zh 903px / en 917px）。
- 走查工具坑（新记）：IAB 每次重启 dsh 后侧栏可能折叠——「插件」rail 按钮点了没反应，先点 Open sidebar 展开；面板行头按钮 textContent 是两个 span 拼接（无空格），前缀文本匹配会落空，用 `.relay_panelMain` 选择器。

### 5. 真实账号只读复核（spec §7.3）

- 管线外置直算（git 取回 ts-resolver + 0.7.0 基线一次性放 .tmp；连接与 key 只读自真实 home，令牌零打印）：真实面板现行生效 key 可调 **9 个模型 id，对 0.7.0 基线与 0.7.1 运行时层均 9/9 全 L0 精确命中，零回归**（0.6.0 时代的「83 ids / 67 命中」是当时 key 分组的更大模型面）。
- 条目构成：0.7.1 运行时 **148 条** vs 0.7.0 基线 147 条——**+1（gemini-4-argon，models.dev live 漂移）**、**0 移除**、1 条值变；OpenRouter 兜底移除未造成条目消失（上一轮基线生成时兜底未注入或恰与第一方重合）。
- 知识库/覆盖/连接/模型同步不受预置空窗影响（本轮无预置期手工验证过的路径全部照常）。

### 6. 质量门与收尾

- vitest **225 通过 / 0 失败**（19 文件；新增 preset-store 13 项 + refresh 重写 14 项，删 delta 矩阵/openrouter fixture/restore 用例；L0-L5 全矩阵与其余既有覆盖不降）；typecheck/build 全绿；client 产物 102.45KB（≤350KB 断言）。
- build-shape：config keys 断言三顶层字段；宿主 ESM externals = schemastery + dsh-storage；专名哨兵审计加 SPEC-0.7.1.md。
- npm pack：8 files（lib×2 + cordis.patch.yml + README + CHANGELOG + LICENSE + package.json），无 src/scripts 泄漏。
- 文档：AGENTS（§1/§2/§3/§4.7 新节/§6/§8 v0.7.1）、README 中英（预置章节重写 + 首次使用需联网 + 惰性残留说明 + Compatibility 修正到 0.2.1——0.7.0 遗留的 0.1.5-rc.2 陈旧版本号一并纠正）、CHANGELOG 0.7.1、PUBLISHING §6/§7（weekly workflow/基线维护整段撤除）。
