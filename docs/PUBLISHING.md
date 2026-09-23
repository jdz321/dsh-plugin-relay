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

## 6. 发版节奏（后续版本）

1. 改代码 → `npm run typecheck && npm test && npm run build` 全绿。
2. `CHANGELOG.md` 追加条目；package.json 升语义化版本。
3. `npm publish`；GitHub 打 tag（可选：附 Release）。
4. 目录条目不用动——版本、下载量、star 由注册表 CI 自动刷新。
