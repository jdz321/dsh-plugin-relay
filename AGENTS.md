# AGENTS.md — dsh-plugin-relay 开发手册（面向 Agent）

> 本文件写给接手本项目的 AI 编码会话（也适用于新同事）：读完这一份即可安全开工。
> 配套文档：README.md / README.zh.md（面向使用者的安装与使用）、docs/WORKLOG.md（逐版本开发日志）、docs/PUBLISHING.md（发布与上架清单）。
> 生态背景：宿主是 DeepSeek Harness（npm 包 `@deepseek-ai/dsh`，下称 dsh）；本仓库是一个发布为 npm 包的 dsh 宿主插件，无 CLI，全部功能在 dsh web 设置页。

## 0. 红线 —— 违反任何一条都会伤到用户环境，动手前先读

1. **操作者可能有自己的 dsh home（`~/.dsh`）和正在运行的实例**。绝不启动它、不读写它、不向它发任何信号；一切开发测试用仓库内或临时目录的隔离 home。
2. **杀进程只按你亲手记下的 PID**。开发端口（默认 3098）上随时可能跑着操作者自己起的实例——不许动。禁止 `pkill -f dsh` / `pkill -f node` 这类模糊匹配。**注意 dsh 是 dev.js 的子进程：只杀父 PID 不会停掉监听端口的 dsh 子进程**，收尾要 `lsof -ti :<port> -sTCP:LISTEN` 按 PID 杀监听者（先 `ps` 确认它确是自己起的 dsh；端口上也可能挂着浏览器/桌面进程的客户端连接，别误杀）。自己起的测试实例一律用其它端口（如 3198/3298）。
3. **凡手工启动 dsh，命令必须内联 `DSH_HOME=<隔离目录绝对路径>`**。漏了它会回退 `~/.dsh`——等于把操作者自己的 dsh 跑起来。`npm start`（`scripts/dev.js`）已强制锚定仓库 home、**故意忽略**外部 `DSH_HOME`，这是特性不是 bug。dev.js 启动后 dsh 会自动开系统默认浏览器，属已知副作用。
4. **仓库内的 `.dsh-home/` 若存在，可能是操作者的真实在用配置**（真实账号与真实 key；虽被 gitignore，但不是测试沙盒）。不要「顺手恢复/重置/清洗」它；任何写入前先 Read 全文确认内容；改了什么要明确报告。**测试一律用从零创建的隔离 home，不用真实 home。**
5. **密钥边界**：中转站访问令牌只存 settings namespace 的 secret 字段（接口层自动脱敏）；API key 明文只写 `.dsh-home/.credentials.yaml`（0600）。任何 HTTP 响应、日志、测试断言、文档、截图、**会话工具输出**都不得出现令牌值或 `sk-` 明文。**测试信息（真实面板地址、账号、key 名称、余额）一律不入 git**——`.gitignore` 已排除 `.dsh-home/`、`.tmp/`、`lib/`、`*.log`、`docs/local.md`，别把临时产物写到其它路径。**本机/账号相关的私密信息统一记录在 `docs/local.md`（已 gitignore）**，公开文档不得携带。
6. **仓库边界**：不修改仓库外的任何文件。未经操作者要求不要 commit；push 一律由操作者执行。
7. **外网直连慢或失败**（GitHub / npm / models.dev）时按操作者环境配置代理（`https_proxy` / `http_proxy`）；models.dev 拉取（`preset:fetch` 脚本与「刷新预置」）在宿主/脚本侧进行，进程要带代理 env 才拉得到。
8. **无人值守运行**：开发会话通常无人值守——不要中途提问；拿不准的事实读 submodule 源码或
   联网查证，禁止编造；设计决策与对任务书的偏离记录进最终报告与 WORKLOG。任务书
   （docs/SPEC-*.md）是验收契约：标注【要求】的条目必须达成，【建议】可自主偏离但须说明理由。

## 1. 项目定位

把 dsh 接入 **new-api 系中转站面板**（one-api / new-api / Veloera / done-hub 等同族；无任何面板专属默认值）。插件 = npm 包 `dsh-plugin-relay`：

- **连接**：baseUrl、访问令牌（write-only）、用户 ID（手动填写）存于 `relay` 设置 namespace，保存即热生效；连接字段由插件动态镜像到 `llm-pi-ai.providers.<route>`（baseURL 等），**不依赖 patch 硬编码**；
- **API Keys**：列出/新建/编辑/删除账户 key（名称/分组/分组倍率/额度/有效期/启停，**不含 key 内容**），一键「使用」切换生效 key（禁用 key 附加警告），切换时同步模型目录；创建 key 的明文在宿主侧剥离（「创建并设为生效」走服务端凭据写入，不做复制 key 功能）；
- **模型**：当前生效 key 可调用的模型（id + 价格 + 分组），三种计价口径；刷新时同步进 dsh 路由目录，**按 id 预合并保留既有字段**；
- **数据看板/使用日志**：余额 + 近 7 天按模型消耗堆叠图（recharts 打进 client 产物，react 系外置）；面板日志分页/筛选/整形（`other` JSON 解析 `frt`，容错）；
- **模型能力**：能力配置真源在插件 namespace——**知识库**（按规范模型名：input/reasoning/contextWindow）+ **按面板 id 覆盖** + **预置层**（`src/knowledge-preset.generated.ts` 编译期基线，`npm run preset:fetch` 生成：models.dev 主流白名单 ∪ 面板公开 `/api/pricing` 规范化并集，仅收录近 `PRESET_MAX_AGE_DAYS=183` 天内发布的模型（models.dev `release_date`，无日期不合资格），无凭据参与；同名用户条目覆盖预置，「刷新预置」在宿主内存重建、重启回落基线）；同步/保存时按「覆盖 → 知识库（自定义 → 预置；精确 → 剥一至两层变体后缀=近似）→ 不触碰」重放到 `llm-pi-ai.providers.relay.models[n].{input,reasoningEfforts,contextWindow}`，只写插件持有配置的字段（官方「模型」页对未配置 id 的手工修改不被冲掉）；能力保存 = 定向 ops（catalogSet/Delete + overrideSet/Delete 逐条路径操作，删除真实生效）+ 一次修订守卫重放；**UI 控件复用宿主 primitives**（见 §4.6）；**插件不管理默认模型**（agent-default-model 是用户自己的事）；
- **热生效**：一切写入走 dsh settings/credentials 服务，运行中会话下一次请求立即生效。

## 2. 仓库结构

```
├─ package.json        # npm 包清单（name: dsh-plugin-relay）；exports 指向 lib/ 产物
├─ cordis.patch.yml    # bundle patch：只挂载宿主插件行（无任何面板专属配置）
├─ screenshots.json    # 插件市场截图声明（指向 assets/ 内图片）
├─ tsdown.config.ts    # tsdown 多产物配置：宿主 ESM + client CJS（__ModuleLoader__ 包裹）
├─ tsconfig.json       # TS strict；jsx react-jsx
├─ vitest.config.ts
├─ src/                # TS 源码（构建产物进 lib/，lib/ 已 gitignore）
│  ├─ index.ts         # 宿主插件入口：relay 设置 namespace + /api/relay/* 路由
│  ├─ constants.ts     # 命名总表（namespace/路由/keyRef/档位/模态）
│  ├─ plan.ts          # section 默认值、选 key、切换计划
│  ├─ relay.ts         # new-api 管理 API 客户端
│  ├─ pricing.ts       # /api/pricing 归一化（三计价口径 + 分组倍率 + vendors）
│  ├─ catalog.ts       # 目录整形与合并（name=id；同步保留既有字段）
│  ├─ route-config.ts  # llm-pi-ai 路由 profile 读写（修订守卫重试、能力字段级合并）
│  ├─ capabilities.ts  # models.dev 客户端（映射/合并/缓存/单飞/refresh）
│  ├─ knowledge.ts     # 知识库/覆盖/预置三层派生规则（matchCatalogName 等）
│  ├─ knowledge-preset.ts             # 预置构建纯逻辑（脚本与运行时共用；白名单在此）
│  ├─ knowledge-preset.generated.ts   # preset:fetch 产物（入库；头部只有计数）
│  ├─ capability-ops.ts # POST /capabilities 定向 ops 处理（可测核心）
│  ├─ http.ts          # HTTP(S) 客户端（超时、可选代理 CONNECT）
│  └─ client/          # 浏览器设置页（六选项卡；section / capabilities / menu-select / dashboard / logs / locale / styles …）
├─ scripts/dev.js      # npm start 开发启动器（强制 DSH_HOME=<仓库>/.dsh-home，默认端口 3098）
├─ scripts/dev.d.ts    # dev.js 的类型声明（供 dev-home 测试导入）
├─ scripts/fetch-knowledge-preset.mjs  # npm run preset:fetch（纯 codegen：node 类型剥离直跑 src，重写生成的源文件，不触发 build）
├─ scripts/ts-resolver.mjs             # 供上脚本 --import 预载：把源码内部 .js 引用解析到 .ts（需 Node ≥22.18）
├─ tests/              # vitest：单测 + fake-settings + mock 中转站面板 + 产物形状/命名审计
└─ docs/               # WORKLOG、SPEC、发布清单等开发文档
```

## 3. 常用命令

```sh
npm install        # @deepseek-ai/dsh 是 devDependency；运行时零 dependencies（schemastery 为 peerDependency）
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js（宿主 ESM）+ lib/client.js（浏览器包裹产物）
npm test           # vitest run（mock 面板 + fake-settings，一律不读写真实 .dsh-home）
                   # 注意：先 npm run build 再 npm test——build-shape 测试读取 lib/ 产物
npm start          # 开发启动：dsh web --port 3098，DSH_HOME 强制 = <仓库>/.dsh-home；--dsh-home <dir> / --port <n> 可覆盖
npm run preset:fetch   # 拉「面板公开 pricing ∪ models.dev」重新生成 src/knowledge-preset.generated.ts（纯 codegen，不 build——产物同步走手动 build / prepublishOnly / CI；脚本经 scripts/ts-resolver.mjs 直跑 src，需 Node ≥22.18）
```

改动 src/ 后必须 `npm run build`，再重装/重链 profile；正在运行的 dsh 实例要重启才会加载新宿主产物（client 产物刷新页面即可）。

把本地改动装进某个 home 的 profile（dsh 的插件安装走 pnpm，需在 PATH）：

```sh
DSH_HOME="$PWD/.dsh-home" node_modules/.bin/dsh plugin --profile web add "$PWD"
# headless profile 同理；改 cordis.patch.yml / 依赖后需重装或重链
```

## 4. dsh 集成语义（改代码前必读，全是踩过的坑）

### 4.1 settings 写入是排队串行异步（最重要的一条）

`settingsService.update(ns, patch)`（`@deepseek-ai/dsh-settings`）把写操作挂到该 namespace 的串行队列（validate → persist → `document[ns]` → commit），返回 promise。**HTTP 处理器里每一个 update 都必须 `await` 完再返回响应**——客户端在响应落地后立刻 refetch，未 await 的写入会输给这次读取。`credentialsService.set` 同为 enqueue 语义，照 await 不误。

- `update` 深合并对象、**数组整体替换**；`mutate(ns, ops, expectedRevision?)` 支持 path 级 set/unset，**path 只能寻址 plain object，数组只能作为整体 set**。
- `get(ns)` 返回**resolved 值**（schema 默认 + composition base + 用户层）：schemastery 会把缺省数组具体化为 `[]`、dict/object 具体化为 `{}`——**把 resolved 值原样写回去会带进这些空壳**，写回前必须清洗（见 `catalog.ts` 的 `cleanModelEntry`，compat 里空值成员也要剪）。
- **同一路径只能注册一条 fetch 路由**：`registerFetchRoute` 遇到重复 path 直接 throw，且会中断整个 inject 回调（之后的路由全部没挂上，浏览器表现为神秘 404）。要一个路径多方法，就 `methods: ['GET','POST']` 一次注册、handler 里按 `request.method` 分支。
- 修订守卫：`mutate` 第三参传 `describe()` 里读到的 revision，不匹配抛 `SETTINGS_CONFLICT`（`code: 'SETTINGS_CONFLICT'`）。对「读-改-写共享结构」（如 models 数组）必须带守卫并重试（见 `route-config.ts` 的 `guardedMutate`，重试 3 次）。

### 4.2 credentials-local 的解析层级

`resolve(ref)`：**启动环境变量（只读，最优先）→ 文件 store（`.credentials.yaml`）→ dotenv 回退**。若启动 env 导出了凭据引用同名变量，它只读遮蔽文件值，此时 `set` 会被 `assertUnshadowed` 拒绝（dsh 固定行为）。空串值视同不存在。注意 `.credentials.yaml` 的 `refs:` 段 dsh 会写成 **flow-style**（`{ KEY: value }`），程序化读取别假设 block 风格。**程序化编辑 home 内文件必须保住文件权限**：credentials-local 启动与热重载都断言 `.credentials.yaml` 为 0600（`assertOwnerOnly`，非属主只读即拒绝加载、整个 dsh 起不来）；「写临时文件再 rename」会让新文件落入 umask 的 0644——改完必须 `chmod 600`（settings.yaml 同理保持 600）。

### 4.3 挂载链（谁把插件带起来）与路由建立

- `package.json` 的 `dsh.bundle.patch: ./cordis.patch.yml`：patch 只有一行——`- insert: - {id: relay, name: dsh-plugin-relay, config: {relayKind, route, keyRef}}`，作为 `relay` namespace 的 composition base。dsh-base 自带 `llm-pi-ai`（零路由休眠）与 `agent-default-model` 的挂载行，**本插件不 patch 它们**。
- **pi-ai 路由由插件在运行时建立**：首次 `/use` 用一次 `settings.update` 写入 `llm-pi-ai.providers.<route>`（api=openai-completions、baseURL=<连接>/v1、apiKeyEnv=<keyRef>、models=合并目录）。**自定义路由没有 models 列表无法通过 pi-ai 的严格校验，所以不存在「空路由骨架」**——连接保存只镜像已存在路由的连接字段（`ensureRouteProfile`），绝不创建路由。
- **`modelOverrides` 对本插件不可用**：pi-ai 源码规定 `modelOverrides` 在「带 models 列表的路由」与「内置目录未描述的路由」上都直接 invalid——中转站路由两者皆是。能力配置因此落在 models 条目自身的 `input`/`reasoningEfforts` 字段上（与官方「模型」页同一份条目），字段级合并由 `route-config.ts` 的「读-改-写 + 修订守卫」保证。**语义边界：能力配置跟随条目存在；切换 key 使模型离开目录时，其能力配置随条目一并移除（该模型已不可调用）；同一 key 内的任何同步/刷新永不冲掉存活模型的能力配置与手工字段。**
- `index.ts` 的 `apply(ctx)`：`ctx.inject(['settings','credentials'])` 里 `installSection` 注册 `relay` namespace（令牌 `role('secret')`）；`ctx.inject(['connection'])` 挂 `/api/relay/*` 路由。全部随插件 fiber 卸载。
- `client/index.tsx` 经 `window.__ModuleLoader__.load({id, factory})` 注入（tsdown banner/intro/footer 包裹）；`ctx.slots.inject('settings.section', …)` 挂设置区（内部自绘六选项卡）；React 18 与 primitives 由宿主供给（client 产物 externals = react 系 + `@deepseek-ai/dsh-client-ui-primitives`，见 §4.6）。React 18 的 useEffect 依赖里**不要放每次渲染都换 identity 的对象**（否则本地草稿会被重建吞掉）。
- **内嵌 webview 会吞 `window.prompt/confirm`**：一切需要确认的交互用 primitives `Modal`（React 组件，可用）或内联控件；不再用两段式按钮。

### 4.4 接口信任围栏

`/api/relay/*` 在 dsh web 的浏览器围栏内：裸 curl 得 401 `unauthorized`（`@deepseek-ai/dsh-client-connection` 的 `requestRejection`）。带会话才能调——浏览器访问启动横幅的带 token URL 后由 cookie 会话。

### 4.5 设置页 slot 契约

`settings.section` slot 的注册形状：`ctx.slots.register({name:'settings.section', id:'relay', order:12, label:()=>t('nav'), inject}, Component)`；`inject` 返回 `{scope, t}`，组件经 `props.scope`/`props.t` 消费。locale：`ctx.locale.register(NS, {zh, en})` + `ctx.locale.bind(NS)`；**组件内一律走 bind 出来的翻译函数按当前语言取词**，不要缓存某一语言的字典对象（否则另一语言环境显示错语言）。

### 4.6 宿主供给的浏览器模块（primitives 纪律）

- `@deepseek-ai/dsh-client-ui-primitives` 及一切 `@deepseek-ai/dsh-client-ui-*` **不是 npm 依赖**：宿主把「自己那版」编译产物经冻结模块表（`PLATFORM_MODULES`，0.1.5-rc.2 起含 primitives）供给插件 bundle 的裸 `require`。因此 **npm 侧无法表达「primitives API ≥ X」**——兼容策略 = `engines.dsh` 下限（`>=0.1.5-rc.2`，首个模块表含所需键的宿主）+ 只消费**稳定子集** + 升级宿主后重跑浏览器走查（视觉行为 npm 测试覆盖不到）。
- **稳定子集**（rc.2 存在、经 diff 实证到 0.1.7-rc.1 仍兼容）：`Button` / `Switch`（label 必填）/ `Pill` / `Tag` / `StateDot` / `Menu`（open/anchor/items/selectedId/onSelect/onClose/align/portal）/ `Modal`（closeLabel 必填）+ `IconChevronDownOutline14`。0.1.7 新增件（settings-form、SegmentedControl、Checkbox 等）**不引入**；若未来出现破坏性漂移，在 `client/menu-select.tsx` 这类包装组件内做能力探测收敛，不在业务代码散落 try/catch。
- 类型：devDependency 装 `@deepseek-ai/dsh-client-ui-primitives`（**精确锁版**，与 `engines.dsh` 下限对应的宿主版本——npm 线与 dsh 同班次发布，`latest` 标签常年停在 rc.1 不代表没发版；升级 dsh 开发依赖时**同步锁步升级本包**）。运行时真源仍是宿主模块表供给的那版，npm 包只供类型；**禁止把 `deepseek-harness/` 源码 import 进产物或 tsconfig**。`tsdown.config.ts` 的 `CLIENT_EXTERNALS` 与 build-shape 测试的 require 白名单都要含该包名。
- 下拉一律走 `client/menu-select.tsx` 的 `MenuSelect`（LanguageRow 同款：锚点按钮 + 当前值 + chevron + `Menu` portal）。已知语义：菜单开着按 Escape，菜单关闭的同时**宿主设置面板也会关**（面板自身在 document 层监听 Escape，官方 LanguageRow 同款行为，非本插件缺陷）。

## 5. 中转站协议事实（new-api 家族）

- 管理 API 鉴权是**成对**的：`Authorization: Bearer <accessToken>` + `New-Api-User: <userId>`，缺一即 401/403。访问令牌 ≠ sk- key——sk- key 是调用凭据，令牌+userId 是管理凭据。
- 端点：`GET /api/user/self`、`GET /api/token/?p=1&size=100`（兼容 `{items,total}` 与裸数组）、`GET /api/user/models`、`GET /api/pricing`（多数面板公开；缺失时优雅降级）、`GET /v1/models`（sk- key，key 可用模型的**权威**来源）。
- `/api/pricing` 三种计价方言：`input_price/output_price`（$/1M tokens，新式按量）> `quota_type=1 + model_price`（按次）> `model_ratio × completion_ratio`（经典倍率）；顶层 `group_ratio` 分组倍率；`vendors: [{id,name,icon}]` + 条目 `vendor_id` 是面板 fork 扩展，用作能力卡片来源徽标（`pricing.ts` 已归一化）。
- models.dev（`https://models.dev/api.json`）字段事实：`modalities.input`（可能含 text/image/pdf 等，映射时与 {text,image} 交集）、`reasoning: boolean`、`reasoning_options` 三态：`{type:'effort',values:[…]}`（映射档位交集）、`{type:'toggle'}` 与 `{type:'budget_tokens',min}`（视为「有推理无档位」，建议 medium 起步）、以及 `reasoning:false`（显式非推理）。同一模型 id 可能出现在多个 provider 下，取并集（档位信息优先于 toggle/false）。
- **token CRUD**：`POST /api/token/`（该 fork 校验「分组不能为空」；响应 `data.key` 是唯一一次明文机会，宿主必须剥离）；`PUT /api/token/` 整对象更新——**status 字段只在 `?status_only=true` 变体下生效**（上游 UpdateToken 语义：普通 PUT 只更新 name/expired_time/remain_quota/unlimited_quota/model_limits*/allow_ips/group），启停须单独一次 status_only PUT；`DELETE /api/token/{id}`；编辑必须以列表原始记录为基合并回传。上游字段名是 snake_case（`remain_quota`/`unlimited_quota`/`expired_time`，`expired_time=-1` 为永久）。
- **使用日志**：`GET /api/log/self?p=&page_size=&type=0&start_timestamp=&end_timestamp=&token_name=&model_name=&group=` → `{data:{page,page_size,total,items}}`；条目含 `cache_read_tokens/cache_creation_tokens/reasoning_tokens/reasoning_effort` 独立列；首字耗时在 `other` JSON 串的 `frt`（毫秒），解析必须容错；名称筛选为子串匹配、分组为精确。
- **用量统计**：`GET /api/log/self/stat[start_timestamp&end_timestamp]` → `{quota,rpm,tpm}`；不带参数是**全量口径**（今日口径须显式传今日零点窗口）。
- **数据看板**：`GET /api/data/self?start_timestamp=&end_timestamp=&default_time=hour` → 裸数组小时桶 `{model_name,created_at,token_used,count,quota}`；面板只保留近期桶（稀疏/空是常态）；插件统一请求 hour 桶、客户端按本地日聚合，不依赖 fork 的 day 语义。`/api/user/self` 有 `quota/used_quota/request_count`。
- **模型 id ↔ models.dev 匹配**：规则为「精确 id → 剥一至两层尾部 `-变体` 段再精确（标注 approximate）→ 放弃」；不做模糊/大小写归一化（实测零增益有误配风险）；未命中多为渠道命名面板特有模型（`grok-video`、`gpt-image-2.5-*` 族）。
- 额度换算：¥ ≈ quota 点数 ÷ 500000（面板口径）。

## 6. 测试与验收

- `npm test`（vitest）：pricing/relay（mock 面板三种方言+vendors）、catalog（name=id、合并保留）、route-config（能力合并/删除/修订守卫重试/同步保留）、capabilities（models.dev 三态映射、缓存单飞、refresh 绕缓存/失败抛错/单飞）、knowledge（含预置层派生：同名覆盖/并集匹配/近似）、knowledge-preset（fixture：白名单/面板规范化/丢弃/并集/release_date 窗口）、capability-ops（定向 ops 路径形状、删除真实生效、重放一次写、坏条目整批拒绝）、capability-draft（entryFromDraft/parseContextWindow 矩阵，K=1024）、build-shape（**vm 沙箱真实加载 client 产物**：捕获 `__ModuleLoader__.load` 定义、调 factory 断言 apply/inject 导出面与 require 白名单——minify 会改写字符串形态，勿用 grep 断言；宿主 ESM externals；**交付物历史专名哨兵零命中审计（哨兵明文见 tests/build-shape.test.ts）**）、dev-home。
- **隔离 home 的正确做法**：`mkdir` 新目录后 `DSH_HOME=<新目录> node_modules/.bin/dsh plugin --profile web add "$PWD"` 从零安装。**不要 `cp -R` 复制现成 home**（profile bundle 解析会断）。
- 浏览器验收：隔离实例（`node scripts/dev.js --dsh-home <临时目录> --port 3198 --no-open`）+ mock 面板（`node .tmp/run-mock.mjs <port>`，`tests/mock-relay.ts` 支持固定端口）+ browser-use / web-gui-tester 技能（若 IAB 输入管线失效，可用本机 Chrome headless + 零依赖 CDP 直驱 `Input.dispatchMouseEvent` 兜底）。走查清单：六 Tab 渲染；连接保存落盘；keys 行↔卡（一次一张卡、应用即写、失败不收卡、Modal 删除、启用 Switch）；Use 后 active 标签即时出现（竞态回归）；模型表三计价；看板四卡一行（getBoundingClientRect 断言同行）；日志两行筛选不叠压 + 三个下拉占位文案 + MenuSelect 开/选/关；能力页：预置折叠区可搜、平台卡收起/展开、1M/256K 换算与非法拒绝、完成即存 → **settings.yaml 落盘断言**（含目录删除真实生效）、刷新预置、无全局保存按钮；禁用 key 警告；**中英两种界面语言各走查一遍**。**注意：dsh 设置对话框会拦截 playwright locator 的指针点击（actionability 超时），DOM 快照可用；点按钮用 cua 坐标或 dom_cua node 路径，且点击可能被吞，要点后验证状态再重试。** 更多实测坑：**scrollIntoView 平滑滚动会让测量
  坐标过期**——用 `behavior:'instant'` 滚动、沉降后复测并对 `elementFromPoint` 校验命中再点；
  **`<details>` 折叠内容与对话框裁剪会让元素不可命中**（有布局但 elementFromPoint 不中），
  需逐候选评分后再点；管道命令记得 `set -o pipefail`（否则脚本失败被 tee 吞掉）。
- **多面板**：起两个 mock 实例（`node .tmp/run-mock.mjs <port>` 各一份）覆盖「多站同时生效」。
- **真实面板写路径的临时 key 约定**：仅允许一次性临时 key（名称前缀 `dsh-temp-`）走
  创建→编辑→删除闭环，用后即删、面板无残留；既有 key 一律不碰。
- **涉及真实账号时**：只读调用可随意；`/use` 等改写操作只在隔离 home 测；真实 home 只做只读确认；任何真实账号信息不入报告、不入 git。

## 7. 改动收尾清单

1. `npm run typecheck`、`npm test`、`npm run build` 全绿。
2. 动了 `src/index.ts` / `src/client/`：按 §6 做浏览器走查（记得重启 dsh 实例加载新宿主产物）。
3. 动了 `/use`、能力保存或 settings 写路径：await 竞态回归 + 落盘断言 + 修订守卫用例。
4. CHANGELOG.md 追加条目；package.json 语义化升版本。
5. 清理：自己起的进程按 PID 杀净（**含 dev.js 的 dsh 子进程**，见红线 2）、`.tmp/` 删除、`git status` 无新增杂物、真实 `.dsh-home` 只保留操作者要求的改动。

## 8. 版本史（细节见 docs/WORKLOG.md）

- **v0.1.0**：初版（CLI + bundle 基础版，vendor 专名命名）。
- **v0.2.0**：连接信息全部进 Web 设置页；同类中转站通用。
- **v0.2.1**：修 `npm start` 误用外部 dsh home（home 解析锚定仓库）。
- **v0.3.0**：纯插件化 npm 包结构（删 CLI）；keys/models UI 重做；`/use` 服务端写竞态修复；自动探测用户 ID 移除。
- **v0.4.0**：全面去 vendor 专名化（包名 dsh-plugin-relay / namespace relay / 路由 /api/relay/* / keyRef RELAY_API_KEY）；**删 prettyModelName**（模型只认 id，目录 name=id）；**设置页四选项卡 + 「模型能力」选项卡**（能力写 models 条目的 input/reasoningEfforts，字段级合并 + 修订守卫；models.dev 参考值；手工增删）；**TypeScript 重构**（src/ → tsdown → lib/；宿主 ESM + client CJS 包裹产物；vitest；tsc strict）。
- **v0.5.0**：模型能力知识库 + 匹配规则（真源移入插件 namespace，路由条目能力字段变派生状态；contextWindow 默认值）；**移除默认模型管理**（不写 agent-default-model，文案同步）；账户行精简（用户名 + 余额）；**API key 增删改**（明文剥离 + status_only 启停）；数据看板（recharts 堆叠图，react 系外置、process.env.NODE_ENV 构建期消解）与使用日志页签；dev 启动器 `--no-open`。
- **v0.5.1（当前）**：体验修订——key **行内原地编辑**（行↔卡，对齐官方 Models 页；删除走 Modal）；**全面复用宿主 primitives**（Button/Switch/Pill/Tag/StateDot/Menu/Modal + MenuSelect 统一下拉，§4.6 纪律；类型用官方 npm 包精确锁版）；看板四卡一行；日志筛选两行布局 + 下拉占位文案修复；**能力页重构**（预置知识库编译期入库 + `preset:fetch`（仅近 183 天发布的模型）+ 「刷新预置」内存层；上下文 `1M`/`256K` 简写；三区全部原地展开、页级单卡；模型 id 完整单行展示、匹配提示置于 id 下方、摘要两行钳制；编辑卡页脚按钮成组靠右对齐官方；`/capabilities` 改定向 ops——删除真实生效；全局保存按钮移除）；client 产物 minify（2.23MB→0.98MB，recharts 树占 ~78%）。
