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
    en: Connects DeepSeek Harness to any new-api-family relay panel (one-api / new-api / Veloera / done-hub), several at once as separate model providers: manage panels and API keys, sync model lists with pricing, review usage, and configure model capabilities from a knowledge base in the web settings page.
    zh: 把 DeepSeek Harness 接入任意 new-api 系中转站面板（one-api / new-api / Veloera / done-hub），支持多套面板同时生效：维护面板与 API key、同步模型与价格、查看用量，并在设置页以知识库配置模型能力。
  ```

  规则：描述会被评审者对照代码逐句核对（数字、端点名都要属实）；含 `: ` 的描述必须加引号；一个 PR 最多 3 条，我们只有 1 条；**只改自己的条目文件**。
- [ ] 提 PR，CI 报什么修什么（同一分支推送即可）。

## 5. 截图（已就位，换图时遵循）

- 截图放仓库 `assets/`，`screenshots.json`（仓库根）声明 1–8 张、相对路径。
- dsh-market 详情页直接读 `screenshots.json`；README 内嵌的图会被市场自动抽取兜底。
- 图片实际由 GitHub 托管（raw.githubusercontent.com），第三方图床会被拒。
- **截图一律用 mock 面板的虚构数据**（mock 面板 + 隔离 home），不得出现任何真实面板地址、账号、key 名称或余额。
- 重拍流程（v0.6.1 起）：`tests/walkthrough/cdp.mjs`（零依赖 CDP 驱动）驱动隔离实例（`node scripts/dev.js --dsh-home <临时目录> --port 3198 --no-open` + mock 面板），中英两轮（dsh 语言偏好服务端持久化，切语言在设置 → 通用 → Language 菜单点选后重载）；六张 = connection（折叠手风琴）/ keys / models / dashboard（双轴）/ logs / capabilities。

## 6. 宿主兼容（每次升级 dsh 开发依赖后必做）

- [ ] `npm install @deepseek-ai/dsh@latest` 后**必须重跑一轮浏览器走查**：插件 UI 消费的 primitives（Button/Switch/Pill/Tag/StateDot/Menu/Modal）由宿主在运行时供给自己的编译版本，npm 侧测试覆盖不到视觉与行为。
- [ ] **锁步升级类型包**：`@deepseek-ai/dsh-client-ui-primitives` 与 `@deepseek-ai/dsh-storage`（v0.7.1 起，peer）以 devDependency 精确锁版（当前均为 `0.2.1-alpha.2`），升级 dsh 开发依赖时同步改成宿主对应版本；schemastery peer（`~3.18.5-alpha.1`）同班次锁步（`.volatile()` 元数据必须与宿主同源）。
- [ ] 只消费「稳定子集」（见 AGENTS §4.6）：宿主新增件不引入，升级后逐项复核。
- [ ] 走查通过的宿主版本记进 README「Compatibility / 兼容性」小节与本清单（当前实测：0.2.1-alpha.2）。
- [ ] `engines.dsh` 下限只在「宿主能力缺口」时才动（当前 `>=0.2.1-alpha.2`，即 entry-config 模型 + 存储栈 + 同班次 primitives 的宿主线）。
- [ ] 若未来 primitives 出现破坏性漂移：先在 `MenuSelect` 等包装组件内做能力探测收敛爆点，不在业务代码里散落 try/catch。

## 7. 预置知识库（v0.7.1 起随版本零维护）

- [ ] **没有编译基线了**：预置由插件在用户侧运行时从 models.dev 获取（每 24h 自动一次 + 手动「刷新预置」），持久化在各用户自己的 `<DSH_HOME>/storages/relay_preset.json`。发版不携带预置数据——weekly workflow、codegen 脚本、基线漂移 PR 已全部移除。
- [ ] 主流口径调整（白名单/窗口/非对话/去重规则）= 改 `src/knowledge-preset.ts` 随版本发布；用户侧下一次刷新即按新口径重建（删除本地 `storages/relay_preset.json` 可立即重置）。

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
