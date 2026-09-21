# AGENTS.md — dsh-plugin-relay 开发手册（面向 Agent）

> 本文件写给接手本项目的 AI 编码会话（也适用于新同事）：读完这一份即可安全开工。
> 配套文档：README.md / README.zh.md（面向使用者的安装与使用）、docs/WORKLOG.md（逐版本开发日志）、docs/PUBLISHING.md（发布与上架清单）。
> 生态背景：宿主是 DeepSeek Harness（npm 包 `@deepseek-ai/dsh`，下称 dsh）；本仓库是一个发布为 npm 包的 dsh 宿主插件，无 CLI，全部功能在 dsh web 设置页。

## 0. 红线 —— 违反任何一条都会伤到用户环境，动手前先读

1. **操作者可能有自己的 dsh home（`~/.dsh`）和正在运行的实例**。绝不启动它、不读写它、不向它发任何信号；一切开发测试用仓库内或临时目录的隔离 home。
2. **杀进程只按你亲手记下的 PID**。开发端口（默认 3098）上随时可能跑着操作者自己起的实例——不许动。禁止 `pkill -f dsh` / `pkill -f node` 这类模糊匹配。**注意 dsh 是 dev.js 的子进程：只杀父 PID 不会停掉监听端口的 dsh 子进程**，收尾要 `lsof -ti :<port> -sTCP:LISTEN` 按 PID 杀监听者（先 `ps` 确认它确是自己起的 dsh；端口上也可能挂着浏览器/桌面进程的客户端连接，别误杀）。自己起的测试实例一律用其它端口（如 3198/3298）。
3. **凡手工启动 dsh，命令必须内联 `DSH_HOME=<隔离目录绝对路径>`**。漏了它会回退 `~/.dsh`——等于把操作者自己的 dsh 跑起来。`npm start`（`scripts/dev.js`）已强制锚定仓库 home、**故意忽略**外部 `DSH_HOME`，这是特性不是 bug。dev.js 启动后 dsh 会自动开系统默认浏览器，属已知副作用。
4. **仓库内的 `.dsh-home/` 若存在，可能是操作者的真实在用配置**（真实账号与真实 key；虽被 gitignore，但不是测试沙盒）。不要「顺手恢复/重置/清洗」它；任何写入前先 Read 全文确认内容；改了什么要明确报告。**测试一律用从零创建的隔离 home，不用真实 home。**
5. **密钥边界**：中转站访问令牌只存 settings namespace 的 secret 字段（接口层自动脱敏）；API key 明文只写 `.dsh-home/.credentials.yaml`（0600）。任何 HTTP 响应、日志、测试断言、文档、截图、**会话工具输出**都不得出现令牌值或 `sk-` 明文。**测试信息（真实面板地址、账号、key 名称、余额）一律不入 git**——`.gitignore` 已排除 `.dsh-home/`、`.tmp/`、`lib/`、`*.log`，别把临时产物写到其它路径。
6. **仓库边界**：不修改仓库外的任何文件。未经操作者要求不要 commit。
7. **外网直连慢或失败**（GitHub / npm / models.dev）时按操作者环境配置代理（`https_proxy` / `http_proxy`）；能力初值查询（↻）经宿主路由代理 models.dev，宿主进程要带代理 env 才拉得到。

## 1. 项目定位

把 dsh 接入 **new-api 系中转站面板**（one-api / new-api / Veloera / done-hub 等同族；无任何面板专属默认值）。插件 = npm 包 `dsh-plugin-relay`：

- **连接**：baseUrl、访问令牌（write-only）、用户 ID（手动填写）存于 `relay` 设置 namespace，保存即热生效；连接字段由插件动态镜像到 `llm-pi-ai.providers.<route>`（baseURL 等），**不依赖 patch 硬编码**；
- **API Keys**：列出账户全部 key（名称/分组/分组倍率/额度/有效期，**不含 key 内容**），一键「使用」切换生效 key（禁用 key 附加警告），切换时同步模型目录与默认模型；
- **模型**：当前生效 key 可调用的模型（id + 价格 + 分组），三种计价口径；刷新时同步进 dsh 路由目录，**按 id 预合并保留既有字段**；
- **模型能力**：按模型配置输入模态（text/image）与推理档位（false | off+档位字典），写 `llm-pi-ai.providers.relay.models[n].{input,reasoningEfforts}`——与官方「模型」页同一份配置、字段级合并互不覆盖；↻ 可从 models.dev 取参考值（宿主代理+缓存）；支持手工添加/删除模型；
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
│  ├─ capabilities.ts  # models.dev 客户端（映射/合并/缓存/单飞）
│  ├─ http.ts          # HTTP(S) 客户端（超时、可选代理 CONNECT）
│  └─ client/          # 浏览器设置页（四选项卡；section.tsx / capabilities.tsx / locale.ts / styles.ts …）
├─ scripts/dev.js      # npm start 开发启动器（强制 DSH_HOME=<仓库>/.dsh-home，默认端口 3098）
├─ scripts/dev.d.ts    # dev.js 的类型声明（供 dev-home 测试导入）
├─ tests/              # vitest：单测 + fake-settings + mock 中转站面板 + 产物形状/命名审计
└─ docs/               # WORKLOG、SPEC、发布清单等开发文档
```

## 3. 常用命令

```sh
npm install        # @deepseek-ai/dsh 是 devDependency；运行时零 dependencies（schemastery 为 peerDependency）
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js（宿主 ESM）+ lib/client.js（浏览器包裹产物）
npm test           # vitest run（mock 面板 + fake-settings，一律不读写真实 .dsh-home）
npm start          # 开发启动：dsh web --port 3098，DSH_HOME 强制 = <仓库>/.dsh-home；--dsh-home <dir> / --port <n> 可覆盖
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

`resolve(ref)`：**启动环境变量（只读，最优先）→ 文件 store（`.credentials.yaml`）→ dotenv 回退**。若启动 env 导出了凭据引用同名变量，它只读遮蔽文件值，此时 `set` 会被 `assertUnshadowed` 拒绝（dsh 固定行为）。空串值视同不存在。注意 `.credentials.yaml` 的 `refs:` 段 dsh 会写成 **flow-style**（`{ KEY: value }`），程序化读取别假设 block 风格。

### 4.3 挂载链（谁把插件带起来）与路由建立

- `package.json` 的 `dsh.bundle.patch: ./cordis.patch.yml`：patch 只有一行——`- insert: - {id: relay, name: dsh-plugin-relay, config: {relayKind, route, keyRef}}`，作为 `relay` namespace 的 composition base。dsh-base 自带 `llm-pi-ai`（零路由休眠）与 `agent-default-model` 的挂载行，**本插件不 patch 它们**。
- **pi-ai 路由由插件在运行时建立**：首次 `/use` 用一次 `settings.update` 写入 `llm-pi-ai.providers.<route>`（api=openai-completions、baseURL=<连接>/v1、apiKeyEnv=<keyRef>、models=合并目录）。**自定义路由没有 models 列表无法通过 pi-ai 的严格校验，所以不存在「空路由骨架」**——连接保存只镜像已存在路由的连接字段（`ensureRouteProfile`），绝不创建路由。
- **`modelOverrides` 对本插件不可用**：pi-ai 源码规定 `modelOverrides` 在「带 models 列表的路由」与「内置目录未描述的路由」上都直接 invalid——中转站路由两者皆是。能力配置因此落在 models 条目自身的 `input`/`reasoningEfforts` 字段上（与官方「模型」页同一份条目），字段级合并由 `route-config.ts` 的「读-改-写 + 修订守卫」保证。**语义边界：能力配置跟随条目存在；切换 key 使模型离开目录时，其能力配置随条目一并移除（该模型已不可调用）；同一 key 内的任何同步/刷新永不冲掉存活模型的能力配置与手工字段。**
- `index.ts` 的 `apply(ctx)`：`ctx.inject(['settings','credentials'])` 里 `installSection` 注册 `relay` namespace（令牌 `role('secret')`）；`ctx.inject(['connection'])` 挂 `/api/relay/*` 路由。全部随插件 fiber 卸载。
- `client/index.tsx` 经 `window.__ModuleLoader__.load({id, factory})` 注入（tsdown banner/intro/footer 包裹）；`ctx.slots.inject('settings.section', …)` 挂设置区（内部自绘四选项卡）；React 18 由宿主供给（client 产物 externals 只有 react / react/jsx-runtime）。React 18 的 useEffect 依赖里**不要放每次渲染都换 identity 的对象**（否则本地草稿会被重建吞掉）。
- **内嵌 webview 会吞 `window.prompt/confirm`**：一切需要确认/输入的交互用内联控件 + 两段式按钮。

### 4.4 接口信任围栏

`/api/relay/*` 在 dsh web 的浏览器围栏内：裸 curl 得 401 `unauthorized`（`@deepseek-ai/dsh-client-connection` 的 `requestRejection`）。带会话才能调——浏览器访问启动横幅的带 token URL 后由 cookie 会话。

### 4.5 设置页 slot 契约

`settings.section` slot 的注册形状：`ctx.slots.register({name:'settings.section', id:'relay', order:12, label:()=>t('nav'), inject}, Component)`；`inject` 返回 `{scope, t}`，组件经 `props.scope`/`props.t` 消费。locale：`ctx.locale.register(NS, {zh, en})` + `ctx.locale.bind(NS)`；**组件内一律走 bind 出来的翻译函数按当前语言取词**，不要缓存某一语言的字典对象（否则另一语言环境显示错语言）。

## 5. 中转站协议事实（new-api 家族）

- 管理 API 鉴权是**成对**的：`Authorization: Bearer <accessToken>` + `New-Api-User: <userId>`，缺一即 401/403。访问令牌 ≠ sk- key——sk- key 是调用凭据，令牌+userId 是管理凭据。
- 端点：`GET /api/user/self`、`GET /api/token/?p=1&size=100`（兼容 `{items,total}` 与裸数组）、`GET /api/user/models`、`GET /api/pricing`（多数面板公开；缺失时优雅降级）、`GET /v1/models`（sk- key，key 可用模型的**权威**来源）。
- `/api/pricing` 三种计价方言：`input_price/output_price`（$/1M tokens，新式按量）> `quota_type=1 + model_price`（按次）> `model_ratio × completion_ratio`（经典倍率）；顶层 `group_ratio` 分组倍率；`vendors: [{id,name,icon}]` + 条目 `vendor_id` 是面板 fork 扩展，用作能力卡片来源徽标（`pricing.ts` 已归一化）。
- models.dev（`https://models.dev/api.json`）字段事实：`modalities.input`（可能含 text/image/pdf 等，映射时与 {text,image} 交集）、`reasoning: boolean`、`reasoning_options` 三态：`{type:'effort',values:[…]}`（映射档位交集）、`{type:'toggle'}` 与 `{type:'budget_tokens',min}`（视为「有推理无档位」，建议 medium 起步）、以及 `reasoning:false`（显式非推理）。同一模型 id 可能出现在多个 provider 下，取并集（档位信息优先于 toggle/false）。
- 额度换算：¥ ≈ quota 点数 ÷ 500000（面板口径）。

## 6. 测试与验收

- `npm test`（vitest）：pricing/relay（mock 面板三种方言+vendors）、catalog（name=id、合并保留）、route-config（能力合并/删除/修订守卫重试/同步保留）、capabilities（models.dev 三态映射、缓存单飞）、capabilities-view（浏览器回归：重建不吞草稿）、build-shape（client 包裹形状、宿主 ESM externals、**交付物 `grep -ri relay` 零命中审计**）、dev-home。
- **隔离 home 的正确做法**：`mkdir` 新目录后 `DSH_HOME=<新目录> node_modules/.bin/dsh plugin --profile web add "$PWD"` 从零安装。**不要 `cp -R` 复制现成 home**（profile bundle 解析会断）。
- 浏览器验收：隔离实例（`node scripts/dev.js --dsh-home <临时目录> --port 3198`）+ mock 面板（`tests/mock-relay.ts` esbuild bundle 后独立进程跑）+ browser-use / web-gui-tester 技能。走查清单：四 Tab 渲染；连接保存落盘；keys 自动加载无 key 材料；Use 后 active 标签即时出现（竞态回归）；模型表三计价无名称列；能力卡片配置→保存→**settings.yaml 落盘断言**；↻ 联网获取；手工添加/删除；禁用 key 警告；**中英两种界面语言各走查一遍**。**注意：dsh 设置对话框会拦截 playwright locator 的指针点击（actionability 超时），DOM 快照可用；点按钮用 cua 坐标或 dom_cua node 路径，且点击可能被吞，要点后验证状态再重试。**
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
- **v0.4.0（当前）**：全面去 vendor 专名化（包名 dsh-plugin-relay / namespace relay / 路由 /api/relay/* / keyRef RELAY_API_KEY）；**删 prettyModelName**（模型只认 id，目录 name=id）；**设置页四选项卡 + 「模型能力」选项卡**（能力写 models 条目的 input/reasoningEfforts，字段级合并 + 修订守卫；models.dev 参考值；手工增删）；**TypeScript 重构**（src/ → tsdown → lib/；宿主 ESM + client CJS 包裹产物；vitest；tsc strict）。
