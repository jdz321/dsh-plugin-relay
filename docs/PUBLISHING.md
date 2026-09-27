# 发布与上架清单（PUBLISHING）

把 dsh-plugin-relay 发布为 npm 包、开源到 GitHub、并上架插件市场的完整步骤。每步做完勾掉。

## 1. GitHub 仓库

- [ ] 在 GitHub 创建仓库 `dsh-plugin-relay`（建议 MIT、公开）。
- [ ] 添加 remote 并推送：
  ```sh
  git remote add origin git@github.com:<owner>/dsh-plugin-relay.git
  git push -u origin main
  ```
  `<owner>` 与 npm 账号确定后记入 `docs/local.md`（gitignored，本机专属信息）。
- [ ] 仓库 topics 加上 **`dsh-plugin`**（awesome-dsh-plugin 收录的硬性要求），可再加 `dsh`、`deepseek-harness`、`new-api`。
- [ ] 仓库 Settings → 开启 Discussions（dsh-market 的评论区直接复用插件的 GitHub Discussions）。
- [ ] 确认仓库描述与 README 首段一致（会出现在目录列表里）。

## 2. package.json 收尾（发布前必做）

- [ ] 填 `repository`（`{"type":"git","url":"git+https://github.com/<owner>/dsh-plugin-relay.git"}`）、`bugs`、`homepage`。
  **不能不填**：npm 包与目录条目的自动映射靠 `repository` 指回收录仓库；乱填则会挂到错误仓库。
- [ ] 核对 `description`（会进目录条目，必须与功能一致、无营销词）。
- [ ] `npm publish --dry-run` 检查包内容（应只有 `lib/`、`cordis.patch.yml`、README/LICENSE/CHANGELOG）。

## 3. npm 发布

```sh
npm publish        # prepublishOnly 会先跑 typecheck + build
```

- [ ] 发布后在 npm 页面确认 README 渲染正常。
- [ ] 发过 npm 后无需向注册表登记任何东西：npm↔目录的映射由 awesome-dsh-plugin 的 CI 从 registry 自动采集。

## 4. 上架 awesome-dsh-plugin（dsh-market 的数据源）

- [ ] 确认仓库创建满 **1 天**（收录 CI 的硬性门槛）。
- [ ] Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，新增**一个文件** `data/plugins/<owner>__dsh-plugin-relay.yml`：

  ```yaml
  url: https://github.com/<owner>/dsh-plugin-relay   # 必须与仓库完全一致
  name: <owner>/dsh-plugin-relay
  category: model                                    # Models & Providers 分类
  description:
    en: Connects DeepSeek Harness to any new-api-family relay panel (one-api / new-api / Veloera / done-hub): manage the connection, browse and switch API keys, sync each key's model list with pricing, and configure per-model input modalities and reasoning efforts from the web settings page.
    zh: 把 DeepSeek Harness 接入任意 new-api 系中转站面板（one-api / new-api / Veloera / done-hub）：维护连接、浏览与切换 API key、同步各 key 的模型与价格，并在设置页配置每个模型的输入模态与推理档位。
  ```

  规则：描述会被评审者对照代码逐句核对（数字、端点名都要属实）；含 `: ` 的描述必须加引号；一个 PR 最多 3 条，我们只有 1 条；**只改自己的条目文件**。
- [ ] 提 PR，CI 报什么修什么（同一分支推送即可）。

## 5. 截图（已就位，换图时遵循）

- 截图放仓库 `assets/`，`screenshots.json`（仓库根）声明 1–8 张、相对路径。
- dsh-market 详情页直接读 `screenshots.json`；README 内嵌的图会被市场自动抽取兜底。
- 图片实际由 GitHub 托管（raw.githubusercontent.com），第三方图床会被拒。
- **截图一律用 mock 面板的虚构数据**（mock 面板 + 隔离 home），不得出现任何真实面板地址、账号、key 名称或余额。

## 6. 宿主兼容（每次升级 dsh 开发依赖后必做）

- [ ] `npm install @deepseek-ai/dsh@latest` 后**必须重跑一轮浏览器走查**：插件 UI 消费的 primitives（Button/Switch/Pill/Tag/StateDot/Menu/Modal）由宿主在运行时供给自己的编译版本，npm 侧测试覆盖不到视觉与行为。
- [ ] **锁步升级类型包**：`@deepseek-ai/dsh-client-ui-primitives` 以 devDependency 精确锁版供类型（当前 `0.1.5-rc.2`），升级 dsh 开发依赖时同步改成宿主对应版本；npm 的 `latest` 标签停在 rc.1 属 prerelease 不挪 tag 的语义，锁版请用精确版本号。
- [ ] 只消费「稳定子集」（见 AGENTS §4.6）：0.1.7 新增的 settings-form 套件、SegmentedControl、Checkbox 等**不引入**，等 npm 宿主线跟上后另立任务评估。
- [ ] 走查通过的宿主版本记进 README「Compatibility」小节与本清单（当前实测：0.1.5-rc.2、0.1.5-rc.3；子集 diff 实证兼容至 0.1.7-rc.1）。
- [ ] `engines.dsh` 下限只在「模块表缺少所需键」时才动（当前 `>=0.1.5-rc.2`，即首个携带 primitives 模块表的宿主）。
- [ ] 若未来 primitives 出现破坏性漂移：先在 `MenuSelect` 等包装组件内做能力探测收敛爆点，不在业务代码里散落 try/catch。

## 7. 预置知识库基线（维护节奏）

- [ ] **每周自动**：`preset-refresh` workflow（每 7 天，cron 在 workflow 顶部可改）跑 `preset:fetch` 与已提交基线 diff，有漂移自动开 PR 供审阅——**不自动合并**；CI 无面板源，跑的是 models.dev 白名单口径（v0.5.1 面板源基线在位期间，PR 会同时去掉面板派生条目，审阅时注意；SPEC-0.6.0 落地后即为纯漂移）。
- [ ] 主流模型发布潮后也可手动跑 `npm run preset:fetch`（读 `.dsh-home` 的面板地址与 models.dev，全程无凭据），diff 产物 `src/knowledge-preset.generated.ts` 并随代码一起提交。
- [ ] 生成文件头部只允许计数信息——**不得**出现面板地址、账号等任何身份信息。

## 8. 发版节奏（后续版本，自动化后；commit 由开发会话执行，push 一律由维护者确认审计后手动完成）

1. 改代码 → `npm run typecheck && npm test && npm run build` 全绿（CI 会在 push/PR 时自动跑同一套）。
2. `CHANGELOG.md` 追加条目；package.json 升语义化版本。
3. `git tag vX.Y.Z && git push origin vX.Y.Z` → **publish workflow 自动跑 typecheck/build/test 并发布 npm**（tag 与 package.json 版本不一致会 fail-fast）；也可发 GitHub Release 之外手动在 Actions 页 Run workflow。
4. 目录条目不用动——版本、下载量、star 由注册表 CI 自动刷新。

## 9. 自动发布配置（一次性，GitHub Actions）

工作流：`.github/workflows/publish.yml`（tag `v*` 或手动触发 → typecheck → build → test → `npm publish --provenance`）；`.github/workflows/ci.yml`（push main / PR 跑测试）。配置步骤：

- [ ] npmjs.com 注册/登录账号（建议开启 2FA）。
- [ ] Account → Access Tokens → **Generate New Token → Granular Access Token**：Permissions 选 **Read and write**；Packages 首次发布选 **All packages**（新包首次发布后可收窄到 `dsh-plugin-relay`）。
- [ ] GitHub 仓库 → Settings → Secrets and variables → Actions → **New repository secret**：名称 `NPM_TOKEN`，值为上面的 token。
- [ ] 首发版本：commit + `git tag v0.5.1 && git push origin v0.5.1` → Actions 的 Publish 跑绿即上架；npm 页面确认 README 渲染与 provenance 徽标。
- [ ] 注意：历史 tag `v0.5.0` 与当前 package.json 版本不一致，若被 push 会触发 Publish 且被版本守卫 fail-fast——属预期防护，不必理会。
- [ ] （可选加固）发布过一次后，可在 npm 包设置里配置 **Trusted Publisher**（GitHub 仓库 + workflow 文件名 `publish.yml`）改用 OIDC 免 token 发布；配置成功后移除 `NPM_TOKEN` secret 即可，workflow 的 `id-token: write` 已就位。
