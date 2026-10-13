# AGENTS.md — dsh-plugin-relay 开发手册（面向 Agent）

> 本文件写给接手本项目的 AI 编码会话（也适用于新同事）：读完这一份即可安全开工。
> 配套文档：README.md / README.zh.md（面向使用者的安装与使用）、docs/WORKLOG.md（逐版本开发日志）、docs/PUBLISHING.md（发布与上架清单）。
> 生态背景：宿主是 DeepSeek Harness（npm 包 `@deepseek-ai/dsh`，下称 dsh）；本仓库是一个发布为 npm 包的 dsh 宿主插件，无 CLI，全部功能在 dsh 的 **Plugins 面板**（0.2.x 的插件配置页宿主；宿主要求 ≥0.2.1-alpha.2）。

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

把 dsh 接入 **new-api 系中转站面板**（one-api / new-api / Veloera / done-hub 等同族；无任何面板专属默认值）。插件 = npm 包 `dsh-plugin-relay`。**v0.6.0 起支持多套面板同时生效**：每套面板是 pi-ai 里的一个独立自定义提供方（模型选择器中并列可选），不是一个切换器。

- **面板（连接）**：`relay.panels` 字典，每条 `PanelConfig = { id, baseUrl, relayKind, accessToken(secret), userId, keyRef, selectedKeyName }`。**面板 id 即 pi-ai 路由键与提供方显示名**（创建后不可改名），规范 `[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}` 且唯一；keyRef 按 `RELAY_API_KEY_<ID 大写规范化>` 生成并去重。主页面只有「连接」与「模型能力」两个 tab。**连接 tab 是手风琴**（v0.6.1）：每面板一个折叠项——折叠态行 = StateDot + 名称 + 元信息（host · 账户 · 余额 · 模型数 · 当前 key，账户行懒加载）+ 直达删除按钮；展开态就地呈现四 tab（keys/模型/看板/日志，`panel-body.tsx`，单开手风琴，无返回按钮）。**面板编辑已移除**（改连接 = 删除重建；`panels-update` 路由与 `updatePanel` 已删，只余 create/delete）；新增 `GET /api/relay/account?panel=<id>` 懒加载账户行（宿主 5s TTL 缓存含失败缓存），`GET /api/relay/panels` 纯配置态秒回（含 `overrideCount`/`defaultModelTarget` 供 R4 删除警告）。连接测试（`POST /api/relay/connection-test`）按四类返回：unreachable / user-mismatch（401 含 New-Api-User 或「不匹配」）/ token-invalid（其它 401）/ error:<detail>。嵌套在 dict 内的 `role('secret')` 由宿主 redact walker 全线脱敏（子代理读源码 + 走查双验证；secret 字段**不得设 default/required**）。
- **API Keys**（按面板，`?panel=`/body.panel 寻址）：列出/新建/编辑/删除账户 key（名称/分组/分组倍率/额度/有效期/启停，**不含 key 内容**），一键「使用」切换该面板生效 key（禁用 key 附加警告），切换时同步该面板路由的模型目录；创建 key 的明文在宿主侧剥离（「创建并设为生效」走服务端凭据写入，不做复制 key 功能）；
- **模型**（按面板）：当前生效 key 可调用的模型（id + 价格 + 分组），三种计价口径；刷新时同步进该面板路由目录，**按 id 预合并保留既有字段**；
- **数据看板/使用日志**（按面板）：余额 + 近 7/14/30 天按模型消耗堆叠图（**手写 SVG**，见 client/dashboard-chart.tsx；recharts 已移除，client 产物 95KB，build-shape 断言 ≤350KB）；面板日志分页/筛选/整形（`other` JSON 解析 `frt`，容错）；
- **模型能力**：能力配置真源在插件 namespace——**知识库**（按规范模型名：input/reasoning/contextWindow/maxTokens，全局）+ **按面板按 id 覆盖**（`capabilityOverrides.<panelId>.<modelId>`）+ **预置层**（`src/knowledge-preset.generated.ts` 编译期基线，`npm run preset:fetch` 生成：**models.dev 主流基线**——第一方作者厂商白名单（16 键）→ 365 天发布窗口（`PRESET_MAX_AGE_DAYS=365`）→ 剔除非对话（模态与名字形态双信号）→ 渠道重复登记去重（剥 `@渠道`/`vendor/`/`-maas`，同名丢弃、孤儿 rekey；发布日期只取第一方条目，渠道日期是脏数据）；可选 OpenRouter 用量兜底仅限脚本侧（`OPENROUTER_API_KEY`），运行时刷新不引入新凭据；同名用户条目覆盖预置；「刷新预置」把与编译基线的差异持久化为 `capabilityPresetDelta`（`{builtAt,removed,changed}`，先 await 落盘再**逐面板重放路由**，`{ok,count,replayed,delta}`），**重启保留**（delta 持续叠加在插件自带基线上），「恢复基线」（`POST /api/relay/preset-restore`，Modal 确认）是唯一回落路径；生效层 = `resolvePreset(baseline, delta)`（knowledge.ts））；匹配层级 **L0-L5**（精确 → 大小写折叠（歧义放弃）→ 剥 1-2 层变体后缀 → 版本分隔符互换（`5.1`↔`5-1` 双向）→ 唯一变体补全（preview/latest/exp）→ 人工别名 `{k3→kimi-k3}`），L1-L5 一律近似；同步/保存/刷新时按「覆盖 → 知识库 → 不触碰」重放到 `llm-pi-ai.providers.<panelId>.models[n].{input,reasoningEfforts,contextWindow,maxTokens}`，只写插件持有配置的字段（清除配置即回落启发式；官方「模型」页手工修改不被冲掉）；能力保存 = 定向 ops（覆盖 ops 携带 `panel` 字段）+ 修订守卫重放；**UI 控件复用宿主 primitives**（见 §4.6）；**插件不管理默认模型**（agent-default-model 是用户自己的事）；
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
│  ├─ index.ts         # 宿主插件入口：relay 设置 namespace（panels 字典）+ /api/relay/* 路由
│  ├─ constants.ts     # 命名总表（namespace/面板 id 规范/keyRef 前缀/档位/模态/上限）
│  ├─ panels.ts        # 面板配置模型（PanelConfig/id 校验/keyRef 生成/路由字段）
│  ├─ panels-ops.ts    # 面板 CRUD（create/update/delete 清理路由+覆盖组+凭据；可测核心）
│  ├─ plan.ts          # 选 key、切换计划、key 元数据整形
│  ├─ relay.ts         # new-api 管理 API 客户端
│  ├─ pricing.ts       # /api/pricing 归一化（三计价口径 + 分组倍率 + vendors）
│  ├─ catalog.ts       # 目录整形与合并（name=id；同步保留既有字段）
│  ├─ route-config.ts  # llm-pi-ai 路由 profile 读写（修订守卫重试、能力字段级合并、unsetRoute）
│  ├─ store.ts         # PluginStore：宿主 settings-forms 服务 + volatile cells → 旧 get/section/update/mutate 门面
│  ├─ capabilities.ts  # models.dev 客户端（映射/合并/缓存/单飞/refresh；limit.context+limit.output）
│  ├─ knowledge.ts     # 知识库/覆盖/预置派生规则（matchCatalogName L0-L5、KnowledgeConfig/KnowledgeView）
│  ├─ knowledge-preset.ts             # 预置构建纯逻辑（主流口径；脚本与运行时共用；白名单/窗口/去重在此）
│  ├─ knowledge-preset.generated.ts   # preset:fetch 产物（入库；头部只有 models.dev 计数）
│  ├─ capability-ops.ts # POST /capabilities 定向 ops 处理（覆盖带 panel 寻址；可测核心）
│  ├─ connection-test.ts # 连接测试（classifyConnectionError 四类；可测核心）
│  ├─ refresh.ts       # 刷新预置 + 逐面板路由重放（可测核心）
│  ├─ http.ts          # HTTP(S) 客户端（超时、可选代理 CONNECT）
│  └─ client/          # 浏览器设置页（主页两 tab：panels-tab 连接手风琴 + capabilities；panel-body 四 tab 就地折叠：keys / models-tab / dashboard(SVG 双轴图) / logs；locale / styles …）
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
npm run preset:fetch   # 拉 models.dev 重新生成 src/knowledge-preset.generated.ts（主流基线：白名单/365 天/非对话剔除/渠道去重；OPENROUTER_API_KEY 可选兜底；面板不再是数据源。纯 codegen 不 build——产物同步走手动 build / prepublishOnly / CI；脚本经 scripts/ts-resolver.mjs 直跑 src，需 Node ≥22.18）
```

改动 src/ 后必须 `npm run build`，再重装/重链 profile；正在运行的 dsh 实例要重启才会加载新宿主产物（client 产物刷新页面即可；0.2.x volatile 写不会重启插件 fiber，宿主产物变更必须重启）。

把本地改动装进某个 home 的 profile（dsh 的插件安装走 pnpm，需在 PATH）：

```sh
DSH_HOME="$PWD/.dsh-home" node_modules/.bin/dsh plugin --profile web add "$PWD"
# headless profile 同理；改 cordis.patch.yml / 依赖后需重装或重链
```

## 4. dsh 集成语义（改代码前必读，全是踩过的坑）

### 4.1 配置模型（0.2.x）：entry config + volatile 热提交（最重要的一条）

dsh ≥0.2.1 没有「settings namespace」了：每个 composition entry（`cordis.patch.yml` 的 insert 行）自带一份 config，用户层落在 **profile patch 文档**（`profiles/<name>/cordis.patch.yml`）。`ctx.settings`（settings-forms 服务）按 **entry id** 寻址：`update(ns, patch)`（对象深合并、数组整体替换）/ `mutate(ns, ops, expectedRevision?)`（path 级 set/unset）/ `describe()`（每 entry 的 `{ns, revision, value, user, secrets?}` 视图）。没有 `get`/`section`/`installSection`——插件自己的状态通过 `apply(ctx, config)` 收到的 **volatile cell** 读（`.get()` 恒最新）。

- **可写性 = schema 声明 `.volatile()`**：`update/mutate/replace` 只允许写 volatile 字段之下的路径（否则抛 `Config field … is not volatile`）；且 describe() 只投影 volatile 字段。本插件四个顶层字段全部 volatile；`llm-pi-ai` 的 `providers`、`agent-default-model` 的全部字段在宿主侧已是 volatile。
- **volatile 写不重启插件**：写走 `configEditor.edit` → loader 对比，volatile-only 差异 → `fiber._config` 原地替换 + cell 原地更新 + 本 fiber 收 `loader/volatile-update`；普通字段差异才会重载 fiber。pi-ai 靠同一事件热重注册路由。
- **宿主服务侧读**：`describe()` 不带 `redactSecrets` 时 value 含 secret 明文（仅限宿主内用）；`user` 是 profile patch 原始层。schemastery 依旧把缺省数组/dict 具体化为 `[]`/`{}` 壳（volatile cell 里也一样），写回前必须清洗（`catalog.ts` 的 `cleanModelEntry`；`normalizePresetDelta` 拒绝 `{builtAt}` 缺失的壳）。
- **插件侧封装**：`src/store.ts` 的 `PluginStore` 恢复了旧的 `get/section/update/mutate/describe` 门面——own ns 读 cell，外部 ns（`llm-pi-ai`、`agent-default-model`）读 describe 视图并按 entry 缓存，由根上下文的 `settings/document-updated` 事件失效。内部模块（route-config/capability-ops/panels-ops/refresh）只认这个门面，测试用 `tests/fake-settings.ts` 直接顶上。
- **HTTP 处理器里每一个写都必须 `await` 完再返回响应**——客户端在响应落地后立刻 refetch，未 await 的写入会输给这次读取（`credentialsService.set` 同为 await 语义；新版空串 value 会被拒）。`mutate` 的 unset 在 base 层有值时回退为「重置为 base」——llm-pi-ai 与 relay 的 base 都是空配置，unset 即真删。
- **同一路径只能注册一条 fetch 路由**：`registerFetchRoute`（`connection.fetch.register` 同物）遇重复 path 直接 throw，且会中断整个 inject 回调。要一个路径多方法，就 `methods: ['GET','POST']` 一次注册、handler 里按 `request.method` 分支。
- 修订守卫：`mutate` 第三参传 `describe()` 里读到的该 entry revision，不匹配抛 `SETTINGS_CONFLICT`（`code` 不变）。对「读-改-写共享结构」（models 数组）必须带守卫并重试（`route-config.ts` 的 `guardedMutate`，重试 3 次）。

### 4.2 credentials-local 的解析层级

`resolve(ref)`：**启动环境变量（只读，最优先）→ 文件 store（`.credentials.yaml`）→ dotenv 回退**。若启动 env 导出了凭据引用同名变量，它只读遮蔽文件值，此时 `set` 会被 `assertUnshadowed` 拒绝（dsh 固定行为）。空串值视同不存在。注意 `.credentials.yaml` 的 `refs:` 段 dsh 会写成 **flow-style**（`{ KEY: value }`），程序化读取别假设 block 风格。**程序化编辑 home 内文件必须保住文件权限**：credentials-local 启动与热重载都断言 `.credentials.yaml` 为 0600（`assertOwnerOnly`，非属主只读即拒绝加载、整个 dsh 起不来）；「写临时文件再 rename」会让新文件落入 umask 的 0644——改完必须 `chmod 600`。0.2.x 的用户配置层是 profile patch（`profiles/<name>/cordis.patch.yml`），旧 `settings.yaml` 由宿主启动时一次性导入并改名 `.imported`。

### 4.3 挂载链（谁把插件带起来）与路由建立

- `package.json` 的 `dsh.bundle.patch: ./cordis.patch.yml`：patch 只有一行——`- insert: - {id: relay, name: dsh-plugin-relay, config: {relayKind, route, keyRef}}`，作为 `relay` namespace 的 composition base。dsh-base 自带 `llm-pi-ai`（零路由休眠）与 `agent-default-model` 的挂载行，**本插件不 patch 它们**。
- **pi-ai 路由由插件在运行时建立**：首次 `/use` 用一次 `settings.update` 写入 `llm-pi-ai.providers.<route>`（api=openai-completions、baseURL=<连接>/v1、apiKeyEnv=<keyRef>、models=合并目录）。**自定义路由没有 models 列表无法通过 pi-ai 的严格校验，所以不存在「空路由骨架」**——连接保存只镜像已存在路由的连接字段（`ensureRouteProfile`），绝不创建路由。
- **`modelOverrides` 对本插件不可用**：pi-ai 源码规定 `modelOverrides` 在「带 models 列表的路由」与「内置目录未描述的路由」上都直接 invalid——中转站路由两者皆是。能力配置因此落在 models 条目自身的 `input`/`reasoningEfforts` 字段上（与官方「模型」页同一份条目），字段级合并由 `route-config.ts` 的「读-改-写 + 修订守卫」保证。**语义边界：能力配置跟随条目存在；切换 key 使模型离开目录时，其能力配置随条目一并移除（该模型已不可调用）；同一 key 内的任何同步/刷新永不冲掉存活模型的能力配置与手工字段。**
- `index.ts` 的 `apply(ctx, config)`：`config` 即 entry 配置的 volatile cells；`ctx.inject(['settings','credentials'])` 里 `settings.configure({auto:false}, ctx.fiber)` 关掉宿主自动生成的配置页、构造 `PluginStore`，并挂 `settings/document-updated`（外部缓存失效）与 `loader/volatile-update`（路由镜像）两个事件；`ctx.inject(['connection'])` 挂 `/api/relay/*` 路由。entry id 经 `ctx.fiber.entry.options.id` 读取（回落 `relay`）。全部随插件 fiber 卸载。
- `client/index.tsx` 经 `window.__ModuleLoader__.load({id, factory})` 注入（tsdown banner/intro/footer 包裹，0.2.x 官方 client 同款）；页面挂 **Plugins 面板的 `plugins.item` slot**（见 §4.5）；client inject = `['slots','locale','configForms']`（`configForms` 由 `@deepseek-ai/dsh-client-ui-settings` 提供，提供 entry 的表单快照与写通道）；React 18 与 primitives 由宿主供给（client 产物 externals = react 系 + `@deepseek-ai/dsh-client-ui-primitives`，见 §4.6）。React 18 的 useEffect 依赖里**不要放每次渲染都换 identity 的对象**（否则本地草稿会被重建吞掉）。
- **内嵌 webview 会吞 `window.prompt/confirm`**：一切需要确认的交互用 primitives `Modal`（React 组件，可用）或内联控件；不再用两段式按钮。

### 4.4 接口信任围栏

`/api/relay/*` 在 dsh web 的浏览器围栏内：裸 curl 得 401 `unauthorized`（`@deepseek-ai/dsh-client-connection` 的 `requestRejection`）。带会话才能调——浏览器访问启动横幅的带 token URL 后由 cookie 会话。

### 4.5 设置页 slot 契约

0.2.x 的插件配置页住 **Plugins 面板**。**第三方 npm 插件的页面挂 `plugins.bundle.config`（keyed slot，key = 包名）**，渲染在「已安装」分组里本包详情页的配置区——**不要挂 `plugins.item`**（那是官方 host-plane 插件的 items 列表，挂上去会以卡片形式混进「官方」分组，v0.7.0 首版踩过）：

```tsx
ctx.effect(() => ctx.configForms.whileServed(['relay'], () =>
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: CLIENT_MODULE_ID, inject: env,
  }, RelaySection))))
```

`whileServed` 监听 describe 镜像（host 不服务 relay entry 时自动摘除页面）；组件 props = `{view: 'page', ...inject() 返回值}`（bundle.config 只传 `view:'page'`，无 form/无 summary 调用）；状态经 `configForms.get('relay')` 自取（与 plugin-manager 共享同一控制器，快照 `{status, value, revision, writable}`）。**不声明 `locale:` 字段**——否则框架会注入按 `(key, params)=>string` 约束的 t，与本插件「字典值是函数」的翻译器冲突；翻译函数走 `ctx.locale.bind(NS)` 后经 inject 传递。locale：`ctx.locale.register(NS, {zh, en})` + `ctx.locale.bind(NS)`；**组件内一律走 bind 出来的翻译函数按当前语言取词**。`settings.section` slot 仍在，但只属于宿主内置设置分区，第三方插件页不走它。样式注意：`relay_section` **不设 max-width**（旧设置页时代的 760px 上限已删）——Plugins 详情页内容列是自适应宽度（~960px），设置区应与之等宽。

### 4.6 宿主供给的浏览器模块（primitives 纪律）

- `@deepseek-ai/dsh-client-ui-primitives` 及一切 `@deepseek-ai/dsh-client-ui-*` **不是 npm 依赖**：宿主把「自己那版」编译产物经 client 模块表（boot manifest 组合，0.2.x 由 `dsh.client.inject`/`external` 声明图边 + shell 静态表）供给插件 bundle 的裸 `require`。因此 **npm 侧无法表达「primitives API ≥ X」**——兼容策略 = `engines.dsh` 下限（`>=0.2.1-alpha.2`）+ 只消费**稳定子集** + 升级宿主后重跑浏览器走查（视觉行为 npm 测试覆盖不到）。
- **稳定子集**（0.2.1-alpha.2 实证）：`Button` / `Switch`（label 必填）/ `Pill` / `Tag` / `StateDot` / `Menu`（open/anchor/items/selectedId/onSelect/onClose/align/portal）/ `Modal`（closeLabel 必填）+ `IconChevronDownOutlineMedium`（0.2.x 图标改名：`*Outline14/16` → `*OutlineMedium/Regular` 双描边）。0.2.x 新增件（SettingsForm 族、SegmentedControl、Checkbox 等）**不引入**——本插件自绘表单；若未来出现破坏性漂移，在 `client/menu-select.tsx` 这类包装组件内做能力探测收敛，不在业务代码散落 try/catch。
- 类型：devDependency 装 `@deepseek-ai/dsh-client-ui-primitives`（**精确锁版**，与 `engines.dsh` 下限对应的宿主版本——npm 线与 dsh 同班次发布；升级 dsh 开发依赖时**同步锁步升级本包与 `@deepseek-ai/schemastery`**——插件导出的 Config 带有 `.volatile()` 元数据，schemastery peer 必须解析到宿主同班次的 3.18.5-alpha.x，3.18.2 没有该方法会在加载时崩）。运行时真源仍是宿主模块表供给的那版，npm 包只供类型；**禁止把 `deepseek-harness/` 源码 import 进产物或 tsconfig**。`tsdown.config.ts` 的 `CLIENT_EXTERNALS` 与 build-shape 测试的 require 白名单都要含该包名。
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
- **模型 id ↔ models.dev 匹配（v0.6.0 L0-L5）**：L0 精确 → L1 大小写折叠精确（折叠后多候选即放弃）→ L2 剥一至两层尾部 `-变体` 段（原样与折叠各试一轮，标注 approximate）→ L3 版本分隔符互换（`(\d).(\d)`↔`(\d)-(\d)` 双向后走 L0/L1）→ L4 唯一变体补全（面板 id（含剥层后）+ 恰一个 preview/latest/exp 恰为某规范名且候选唯一）→ L5 人工别名表 `{k3→kimi-k3}`（knowledge.ts `PRESET_ALIASES`）→ 放弃；L1-L5 一律近似。每层全等 + 唯一性约束，无模糊/包含匹配；实证命中率 67/83（miss = 图像视频类 + gemini-2.5 出窗）。
- 额度换算：¥ ≈ quota 点数 ÷ 500000（面板口径）。

## 6. 测试与验收

- `npm test`（vitest）：pricing/relay（mock 面板三种方言+vendors）、catalog（name=id、合并保留）、route-config（能力合并/删除/修订守卫重试/同步保留/maxTokens 回落/unsetRoute/分组覆盖视图）、capabilities（models.dev 三态映射、limit.output、缓存单飞、refresh 绕缓存/失败抛错/单飞）、knowledge（**L0-L5 层级矩阵**：casefold/版本分隔/变体补全唯一性/别名/歧义放弃/strip 回归；maxTokens 校验；分组 overrides 归一；**预置增量层**：normalizePresetDelta/resolvePreset/diffPreset/summarize 矩阵）、knowledge-preset（fixture：主流白名单/365 天窗口/非对话双信号/渠道去重 drop+rekey/首方日期权威/OpenRouter 注入与降级/slug 映射）、capability-ops（定向 ops 路径形状、覆盖带 panel 寻址、删除真实生效、空组清理、重放一次写、坏条目整批拒绝）、panels-ops（CRUD/id 校验与唯一/keyRef 生成去重/删除清理落盘/凭据 unset 告警）、refresh（刷新写 delta 落盘+逐面板重放/单面板失败不回滚 delta/取数失败先于写抛错/恢复基线 unset+重放）、account（5s TTL 缓存命中/失败缓存/按面板隔离/TTL 过期恢复）、panels（panelSummaries 纯配置态含 overrideCount/defaultModelTarget 且无 account 字段）、connection-test（四类分类矩阵 + mock 面板 401 两形态 + 死端口）、dashboard-chart（刻度/抽稀/堆叠几何/linePath-linePoints/Top-N 合并稳定排序纯函数）、capability-draft（entryFromDraft/parseContextWindow 矩阵，K=1024，maxTokens 上限 1,048,576）、build-shape（**vm 沙箱真实加载 client 产物**：捕获 `__ModuleLoader__.load` 定义、调 factory 断言 apply/inject 导出面与 require 白名单——minify 会改写字符串形态，勿用 grep 断言；宿主 ESM externals；**client 体积 ≤350KB 断言**；嵌套 secret schema 断言；**交付物历史专名哨兵零命中审计（哨兵明文见 tests/build-shape.test.ts）**）、dev-home。**走查/截图工具入库**：`tests/walkthrough/cdp.mjs`（零依赖 CDP 驱动：eval/click 带元素命中校验/DOM-click 兜底/截图，库 + CLI）与 `shot.mjs`；不进 npm pack。**插件设置语言切换**：`locale.preference` 服务端持久化。
- **隔离 home 的正确做法**：`mkdir` 新目录后 `DSH_HOME=<新目录> node_modules/.bin/dsh plugin --profile web add "$PWD"` 从零安装。**不要 `cp -R` 复制现成 home**（profile bundle 解析会断）。
- 浏览器验收：隔离实例（`node scripts/dev.js --dsh-home <临时目录> --port 3198 --no-open`）+ mock 面板（`node .tmp/run-mock.mjs <port>`，`tests/mock-relay.ts` 支持固定端口；多面板起两个 mock 实例）+ **ZCode 自带 browser-use 技能（v0.7.0 起首选**：IAB 后端 locator/snapshot/截图全链路可用，语言切换走 `settings/mutate` RPC 写 `locale.preference` 后 reload；`tests/walkthrough/cdp.mjs` 退为脚本化批量断言的备用工具）（**v0.6.1 IAB 排查结论：0.6.0 的「输入管线失效」不复现**——locator 点击、cua 坐标、DOM click 均能送达 dsh 对话框，当时的失败是 Modal 遮罩遮挡与临时宿主缺陷；CDP 直驱（`tests/walkthrough/cdp.mjs`，入库工具）仍用于截图与脚本化走查；IAB `fill('')` 空串不落 DOM 是工具层怪癖，清空输入用原生 setter + input 事件）。走查清单：主页两 tab（连接/模型能力）渲染；面板手风琴（折叠行 = 圆点 + 名称 + 元信息 + chevron，**无按钮**——删除只在展开后的体部头（测试连接旁），折叠行头曾有过直达删除、v0.7.0 应操作者要求移除（与展开态重复）/ 展开唯一性 / 新增卡 create-only 无编辑）+ 双面板同时生效（两条路由落盘）+ 删除清理（路由/覆盖组/凭据引用）落盘断言 + 删除 Modal 两行警告（覆盖条数 / 默认模型指向）；**0.2.x 走查入口：侧栏「插件」→ relay 卡片（summary 单行）→ 详情页两 tab**；四 tab 就地折叠回归；账户行懒填充（不可达面板不阻塞列表）；keys 行↔卡（一次一张卡、应用即写、失败不收卡、Modal 删除、启用 Switch）；Use 后 active 标签即时出现（竞态回归）；禁用 key 警告；模型表三计价；看板四卡一行（getBoundingClientRect 断言同行）+ 7/14/30 切换 + 指标三态（金额/Token/双轴：右轴刻度+折线+图例条目）+ Top-N「其他」合并（9 模型 mock；「其他」图例不可点）+ SVG 图几何断言（文字/折线均在 SVG 界内）；日志两行筛选不叠压 + 三个下拉占位文案 + MenuSelect 开/选/关；能力页：预置折叠区可搜（~140 条）+ 增量状态行（编译基线 N 条 · 已刷新 +x/−y）+ 恢复基线（Modal→unset 落盘→重放）+ **重启后增量仍在**（dsh 进程重启验证）、平台卡按面板分组 + **覆盖率分段可点过滤**（切/换/清三态）、匹配徽标（mock 含小写 id / `x.1` 式 id / 缺 preview id / k3 别名）、maxTokens 编辑与落盘断言（`profiles/web/cordis.patch.yml` 精确断言，含清除回落）、完成即存、刷新预置（含重放消息）、无全局保存按钮；连接测试四态（正常/坏 token/坏 userId/死端口）；**中英两种界面语言各走查一遍**（语言偏好服务端持久化于 `locale.preference`，headless Chrome 按 navigator.language 初判——无存储偏好时插件区可能在壳采纳语言前短暂显示另一语言，截图前先在菜单里点一次目标语言）。**RPC envelope 定案（v0.6.1，0.2.x 实测不变）**：`POST /api/settings/describe` body = `{type:'client-request', rpcId(字符串), method:'settings/describe', payload:{args:{}}}`（payload 必须恰好一个 plain-object `args` 字段）；**响应 result.value = `{writable, hasDocument, namespaces:[{ns,revision,value,user,secrets?,autoGenerate,applies}]}`**（0.2.x 新形状）；走查用它直接断言 relay 视图零令牌明文 + `secrets` sidecar 含 `panels.<id>.accessToken`。语言切换可直接走 `settings/mutate` RPC：`payload:{args:{ns:'locale', ops:[{op:'set', path:['preference'], value:'en'}]}}` 后 reload。**注意事项更新：locator 点击可能因 Modal 遮罩（aria-hidden mask）actionability 超时——先关弹窗再点；点击可能被吞，要点后验证状态再重试。** 更多实测坑：**scrollIntoView 平滑滚动会让测量
  坐标过期**——用 `behavior:'instant'` 滚动、沉降后复测并对 `elementFromPoint` 校验命中再点；
  **`<details>` 折叠内容与对话框裁剪会让元素不可命中**（有布局但 elementFromPoint 不中），
  需逐候选评分后再点；管道命令记得 `set -o pipefail`（否则脚本失败被 tee 吞掉）。
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

- **v0.7.0（当前）**：**宿主升级 dsh ≥0.2.1-alpha.2（不兼容旧宿主线）**。0.2.x 的配置模型重构：插件状态从 `relay` settings namespace 迁到 composition **entry config**（用户层 = profile patch 文档 `profiles/<name>/cordis.patch.yml`；旧 settings.yaml 由宿主自动导入）；Config 四个顶层字段全部 `.volatile()`（写热提交、不重启 fiber；`apply` 收 volatile cells，`loader/volatile-update` 取代 installSection 的 onChange）；`installSection`/`get`/`section` 移除——`src/store.ts` 的 `PluginStore` 重建旧门面（own ns 走 cell，`llm-pi-ai`/`agent-default-model` 走 describe 视图 + `settings/document-updated` 失效缓存）；**配置页从 `settings.section` slot 迁到 Plugins 面板的 `plugins.item` slot**（`configForms.whileServed(['relay'])` 守护 + `view: 'summary'|'page'` 双渲染；`settings.configure({auto:false})` 关宿主自动页）；primitives 图标改名 `IconChevronDownOutline14→Medium`（Button/Switch/Menu/Modal 子集不变）；schemastery peer 锁 `~3.18.5-alpha.1`（`.volatile()` 必须与宿主同班次）；`dsh.client.inject` 增加 plugin-manager。实测（隔离 home，0.2.1-alpha.2）：面板 CRUD、/use（凭据+pi-ai 路由+能力推导）、模型同步、能力 ops（覆盖增删+空组清理）、连接测试、看板/日志、刷新预置（落盘 delta + 全面板重放）、删除清理、重启后 delta 保留、describe 脱敏 sidecar 全部通过；浏览器走查中英 17/17；profile patch 写出的 `reasoningEfforts.off: null` 完好（js-yaml 写入，无 v0.6.1 PyYAML 问题）。
- **v0.1.0**：初版（CLI + bundle 基础版，vendor 专名命名）。
- **v0.2.0**：连接信息全部进 Web 设置页；同类中转站通用。
- **v0.2.1**：修 `npm start` 误用外部 dsh home（home 解析锚定仓库）。
- **v0.3.0**：纯插件化 npm 包结构（删 CLI）；keys/models UI 重做；`/use` 服务端写竞态修复；自动探测用户 ID 移除。
- **v0.4.0**：全面去 vendor 专名化（包名 dsh-plugin-relay / namespace relay / 路由 /api/relay/* / keyRef RELAY_API_KEY）；**删 prettyModelName**（模型只认 id，目录 name=id）；**设置页四选项卡 + 「模型能力」选项卡**（能力写 models 条目的 input/reasoningEfforts，字段级合并 + 修订守卫；models.dev 参考值；手工增删）；**TypeScript 重构**（src/ → tsdown → lib/；宿主 ESM + client CJS 包裹产物；vitest；tsc strict）。
- **v0.5.0**：模型能力知识库 + 匹配规则（真源移入插件 namespace，路由条目能力字段变派生状态；contextWindow 默认值）；**移除默认模型管理**（不写 agent-default-model，文案同步）；账户行精简（用户名 + 余额）；**API key 增删改**（明文剥离 + status_only 启停）；数据看板（recharts 堆叠图，react 系外置、process.env.NODE_ENV 构建期消解）与使用日志页签；dev 启动器 `--no-open`。
- **v0.6.1（当前）**：**连接 tab 折叠化**（手风琴单开，四 tab 就地折叠；编辑功能与 `panels-update` 路由移除——改连接=删除重建；新增卡标签缩短+hint 下沉、两列输入框顶边对齐；head 按钮 nowrap）；**/panels 秒回 + account 懒加载**（5s TTL 缓存含失败；行内「…」→填充）；**预置增量层**（`capabilityPresetDelta` 持久化，重启保留，恢复基线一键回编译态；resolvePreset/diffPreset 纯函数；四处文案同步）；**图表双轴 + Top-N**（左轴金额柱+右轴 Token 折线；第 7 名外并灰色「其他」，图例不可隐藏）；**删除 Modal 增强**（覆盖条数 + 默认模型指向警告，不拦截）；**覆盖率分段可点过滤**；**工程项**（渠道去重 Set 化——preset:fetch 产物仅 live 漂移；IAB 排查翻案：输入管线正常，失效系遮遮挡与临时缺陷；RPC envelope 定案 + describe 脱敏直接断言；走查/截图脚本入库 tests/walkthrough/；真实账号只读验证：11 模型全 L0 命中、刷新 143 条）。真实面板 route 写入曾因 PyYAML 往返毁掉 `reasoningEfforts.off` 键（YAML 1.1 布尔）被 pi-ai 校验拒绝——手工编辑 home 文件保原文，教训入 WORKLOG。
- **v0.6.0**：**多套中转站**（`relay.panels` 字典，面板 id=路由键=提供方名，连接列表 + 二级页四 tab；删除清理路由/覆盖组/凭据；嵌套 secret 全线脱敏实证）；**预置基线改主流口径**（models.dev 第一方白名单 16 键 → 365 天窗口 → 非对话剔除 → 渠道去重/rekey；面板不再是数据源；发布日期只取第一方条目；OpenRouter 可选兜底；基线 140 条）；**匹配升级 L0-L5**（casefold/版本分隔互换/唯一变体补全/`k3` 别名；实证 67/83）；**刷新预置自动重放**全部已配置路由（v0.5.1 缺口修复）；**maxTokens 进能力体系**（limit.output 提取/校验 ≤1,048,576/重放/清除回落）；**连接测试**四态分类；**手写 SVG 堆叠图替换 recharts**（983KB→95KB，350KB 断言进 build-shape）；看板 7/14/30 + 图例显隐；覆盖率指示；摘要 1M 化（1024 基 tokenCountText）。
- **v0.5.1**：体验修订——key **行内原地编辑**（行↔卡，对齐官方 Models 页；删除走 Modal）；**全面复用宿主 primitives**（Button/Switch/Pill/Tag/StateDot/Menu/Modal + MenuSelect 统一下拉，§4.6 纪律；类型用官方 npm 包精确锁版）；看板四卡一行；日志筛选两行布局 + 下拉占位文案修复；**能力页重构**（预置知识库编译期入库 + `preset:fetch`（仅近 183 天发布的模型）+ 「刷新预置」内存层；上下文 `1M`/`256K` 简写；三区全部原地展开、页级单卡；模型 id 完整单行展示、匹配提示置于 id 下方、摘要两行钳制；编辑卡页脚按钮成组靠右对齐官方；`/capabilities` 改定向 ops——删除真实生效；全局保存按钮移除）；client 产物 minify（2.23MB→0.98MB，recharts 树占 ~78%）。
