# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.6.0] - 2026-09-28

Minor release with a reworked preset baseline, a maxTokens capability field, connection testing, a hand-written SVG chart (recharts removed, client bundle ~10× smaller), and the biggest structural change: **multiple relay panels at once**, each one its own dsh model provider. The `relay` namespace schema changes shape (legacy flat connection fields replaced by a `panels` dict, overrides grouped per panel) — the plugin was never formally released, so there is **no migration**; hand-edit your `settings.yaml` when upgrading from an 0.5.x checkout (see docs/WORKLOG.md for the field mapping).

### Added

- **Multi-panel**: the *Connection* tab is now a panel list — each row shows a state dot, the panel name (= the dsh model provider's name, immutable after creation, `[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}`), the host, account, balance, synced model count, and active key, with Test / Edit / Delete actions; clicking a row opens the panel's **detail page** with its own API keys / Models / Dashboard / Usage logs tabs. Every panel becomes an independent pi-ai provider (`openai-completions` at `<panel>/v1`, credential reference `RELAY_API_KEY_<PANEL>` auto-generated and deduplicated), so dsh sessions see all panels' models side by side. Deletion (Modal, cleanup scope spelled out) removes the panel's route, its capability-override group, and its credential reference; the global knowledge base survives. Panel tokens are write-only secret fields nested inside the panels dict — the settings wire redacts them (verified against the host's redact walker and in the browser).
- **Connection test**: a *Test connection* button on each panel row and on the detail page (`POST /api/relay/connection-test`) probes `GET /api/user/self` with the saved settings and classifies the failure the way the operator experiences it — `unreachable` (address/network/proxy), `user-mismatch` (HTTP 401 naming the New-Api-User pairing), `token-invalid` (any other 401), or a passthrough panel error; success shows the account name and balance. It never runs automatically on save.
- **maxTokens capability field**: knowledge entries, per-panel overrides, and the preset layer now carry an output limit alongside the context window. models.dev `limit.output` feeds the preset (`mapModelsDevEntry`, largest value wins on merge, positive integers only); the capability editor gains an 输出上限 field with the same `64K`/`1M` shorthand (capped at 1,048,576); syncs and saves write it to the route entries' `maxTokens` only when configured — clearing the config falls back to the route heuristic.
- **Layered knowledge-base matching (L0–L5)**: exact id → case-folded exact (ambiguous folds give up) → strip up to two trailing `-variant` suffixes (verbatim, then folded) → version-separator swap (`5.1`↔`5-1`, both directions) → unique variant completion (`preview`/`latest`/`exp`) → curated aliases (`k3` → `kimi-k3`). Everything past L0 is marked approximate. Measured against a live panel: 67/83 ids matched (up from 71 under the old first-party-only baseline and 80 under the old panel-fed baseline — the misses are image/video models and the gemini-2.5 family aging out of the window).
- **Dashboard range pills**: 7 / 14 / 30-day switches refetch `?days=N`; the chart legend toggles series visibility.
- **Preset coverage indicator**: each panel group in the platform-models section shows 「N models: preset X · knowledge Y · override Z · unconfigured W」 derived from the per-model source badges.
- **1M-compacted summaries**: capability summaries render token counts 1024-based (`1048576` → `1M`, `131072` → `128k`) and append the output limit when configured.

### Changed

- **Preset baseline rebuilt around models.dev mainstream models only** (`npm run preset:fetch` and the runtime 刷新预置 share `buildPresetEntries(doc)`): first-party author-provider whitelist (16 api.json keys: openai, anthropic, google, google-vertex, xai, deepseek, alibaba, alibaba-cn, moonshotai, moonshotai-cn, zai, zhipuai, minimax, minimax-cn, xiaomi, mistral) → **365-day release window** (was 183; the panel is no longer a baseline source) → non-dialogue models excluded (embedding/tts/image/video/music, judged by output modalities and name form) → channel re-registrations deduped (`@channel` suffix / `vendor/` prefix / `-maas` suffix stripped; duplicates of a bare entry dropped, orphans rekeyed to the bare name — keeps MaaS-only entries like `claude-opus-5-5@default` → `claude-opus-5-5`). Release dates come from the first-party entries only — aggregator `release_date` fields are frequently garbage. Baseline at release: **140 entries** (~26 KB source). Optional OpenRouter usage backstop: with `OPENROUTER_API_KEY` set, `preset:fetch` folds the last-7-days top-usage slugs (mapped onto models.dev names) through the same filters; the runtime refresh never introduces credentials.
- **刷新预置 now replays the derivation into every configured panel route** (`{ ok, count, replayed }`; the v0.5.1 refresh only rebuilt the memory layer and waited for the next key switch / sync / save to touch the routes). Replay failures are reported readably without rolling the fresh layer back; the UI message says 「已刷新预置（N 条）并同步到模型目录」.
- **Hand-written SVG stacked bar chart replaces recharts**: one color per model (design-token palette), integer Y ticks (1-2-5 steps; decimal steps only for sub-1 CNY data), date labels thinned to fit, native `<title>` hover (`模型 · 日期 · ¥x / N tok`), click-to-hide legend. The layout math (nice ticks, label thinning, column stacking) is extracted into pure unit-tested functions. recharts left the devDependencies; the minified client bundle drops **983 KB → 95 KB**, and a build-shape test caps it at 350 KB.
- Platform models in the capabilities tab render **grouped by panel** (subsection header = panel name + coverage indicator); override operations address `capabilityOverrides.<panel>.<id>` and the platform card shows its owning panel.

### Removed

- `recharts` and the client build's `process.env.NODE_ENV` define (no dependency tree needs it anymore).
- The preset build's panel source: `preset:fetch` lost `--panel` and the `.dsh-home` parsing; the generated file's header carries models.dev dates and counts only. `POST /api/relay/knowledge-refresh` no longer reads the panel's pricing.
- The legacy flat connection fields (`baseUrl` / `relayKind` / `accessToken` / `userId` / `keyRef` / `route` / `selectedKeyName`) at the top of the `relay` namespace — replaced by the `panels` dict; capability overrides moved from `capabilityOverrides.<modelId>` to `capabilityOverrides.<panelId>.<modelId>`. The bundle patch mounts the plugin without any config row now.

## [0.5.1] - 2026-09-24

Experience-polish release; no data-format changes (the `relay` namespace schema only gains optional keys derived at runtime).

### Added

- **Knowledge preset layer**: a compiled-in preset knowledge base (98 entries at release) generated by the new `npm run preset:fetch` — models.dev mainstream providers ∪ the panel's public `/api/pricing` model list (credentials never involved), **restricted to models released within the last ~6 months** (models.dev `release_date`; undated entries cannot qualify). Presets join the derivation as a layer below your own entries; a same-named custom entry overrides one, which is also the only way to suppress a bad preset. `GET /api/relay/capabilities` returns the preset map; the capabilities tab shows the preset section collapsed with a name filter and the *Refresh presets* button inside, and *Edit* on a preset expands the row in place, saving the copy as your entry on *Done*.
- **Client artifact minification**: the browser bundle ships at ~0.98 MB instead of 2.23 MB (recharts and its dependency tree account for ~78% of the artifact; the build now minifies).
- **Refresh presets**: `POST /api/relay/knowledge-refresh` force-fetches models.dev (bypassing the TTL cache, single-flight, hard-failing so the UI can show a retryable error) and rebuilds the preset layer in host memory; a restart deliberately falls back to the compiled baseline. One button on the capabilities tab replaces every per-row ↻.
- **Context-window shorthand**: capability context inputs accept `128K` / `1M` style (1024-based) with a live conversion hint (`1M = 1,048,576`); invalid values are rejected client- and host-side.
- **Compatibility section** in the READMEs: `engines.dsh >= 0.1.5-rc.2`, browser-verified on 0.1.5-rc.2/rc.3, primitives subset diff-verified through the 0.1.7-rc.1 tag.

### Changed

- **All three capability sections edit in place** (official Models-page row↔card idiom): 我的条目 rows, preset rows, and platform rows expand into an editor card at their own position — one card open across the whole page, *Done* writes immediately (busy label), failures keep the card open. Row action buttons are uniform (outline sm at the right edge, like the API-keys rows) and every editor footer groups its buttons on the right — 取消 (outline) immediately left of the primary action, exactly like the official Models page. The platform model's matched knowledge-base name renders **under the id**; model ids always render **in full on one line** (never ellipsized or wrapped — the summary area clamps to two lines instead), and the *Refresh presets* button moved inside the preset panel next to the filter.
- **API-key editing goes in place** (official Models-page row↔card interaction): one editor card open at a time, *Apply* writes immediately (busy label), failures keep the card open with the panel error inside, and deletions confirm through a primitives `Modal` instead of a two-step button.
- **Every capability card now commits itself**: *Done* on a platform card or knowledge card saves via directed operations and closes on success; the global save button and the batch-dirty/reconcile machinery are gone. `POST /api/relay/capabilities` now takes targeted ops (`catalogSet` / `catalogDelete` / `overrideSet` / `overrideDelete`) applied as per-entry settings path ops — deletions are real — followed by one revision-guarded replay over the route.
- **Platform cards collapse by default**; *Edit* expands one card in place (id + vendor + source badge + summary header). Clearing an override confirms in a `Modal`.
- **dsh primitives everywhere**: buttons, switches, pills, tags, state dots, modals, and dropdowns now come from `@deepseek-ai/dsh-client-ui-primitives` (host-supplied through the frozen module table at runtime — kept as a bare external require; types come from the npm package pinned to the host-matching version as a devDependency). All dropdowns are one `MenuSelect` wrapper (anchor + chevron + portaled `Menu`, the official LanguageRow idiom) — including the key-group selector and the log filters.
- **Dashboard cards sit four-in-a-row** at the settings-dialog width (numeric font and padding compacted; two-per-row under 480 px viewports).
- **Log filters are two clean rows** — the time range spans its own row, the three dropdowns + query/reset share the second — and the three dropdown placeholders are per-field again (全部模型 / 全部密钥 / 全部分组; previously all three read "选择分组…").
- **Key editor group options carry billing ratios**: options render as 「name ratio (description)」 — e.g. `claude-stable 0.65x (高智高缓，稳定)` — with pieces the panel does not report dropped; the host now ships per-group ratios in the `/keys` payload.
- **Empty key name falls back to the group name**: applying a create/edit card with a blank name field names the key after its selected group.
- Status messages render as `role="status" aria-live="polite"` regions.

### Removed

- Per-row ↻ "fetch defaults from models.dev" buttons on the capabilities tab (superseded by the preset layer and the unified refresh; the `/api/relay/model-info` host route remains available).

## [0.5.0] - 2026-09-24

### Added

- **Model capability knowledge base**: capability config (input modalities, reasoning, default context window) now lives in the plugin's own settings namespace, keyed by canonical model name — it never changes with key switches. Catalog syncs apply it to the route entries by matching rule: exact panel id → one-or-two trailing variant-suffix strips (marked approximate) → give up. Per-panel-id overrides take precedence over the knowledge base; ids without plugin config are left untouched, so manual edits from the official Models page survive.
- **Default context window**: capability entries and the models.dev lookup now cover `limit.context`, written to the route entries' `contextWindow` (replacing the heuristic value when configured).
- **Key management on the API keys tab**: create, edit (name / group / quota / expiry / enable-disable), and delete keys — all through the panel's management API. Key material never crosses to the browser: creation responses are stripped server-side, and "create and set active" runs the regular switch flow so the secret only enters the credential store. Deleting the active key warns.
- **Dashboard tab**: balance / today / totals cards plus a stacked per-model usage chart (spend vs tokens) of the last 7 days, rendered with recharts (bundled into the client artifact; react stays external). Sparse panel data renders as a readable empty state.
- **Usage logs tab**: panel request logs with a statistics header (usage / RPM / TPM over the filter window), time / model / key / group filters applied on query, and an eight-column table including cache and reasoning token detail and first-response time (parsed from the panel's `other` JSON blob, fault-tolerant).
- `npm start -- --no-open` boots the dev instance without opening the system browser.

### Changed

- **The plugin no longer manages a default model.** Switching keys no longer writes `agent-default-model` (that namespace stays the user's own business in dsh); status lines and success messages drop the default-model clause.
- The account line on the API keys tab is reduced to username + balance; group and ratio stay on each key row where they belong.
- Capability tab restructured into *Knowledge base* + *Platform models* sections with source badges (override / knowledge base / approximate / unconfigured).
- The client bundle resolves `process.env.NODE_ENV` at build time (the browser module table has no `process`); `react-dom` joins the external react-family list.

## [0.4.0] - 2026-09-21

### Added

- Settings page is now a four-tab section: **Connection / API Keys / Models / Capabilities**.
- **Capabilities tab**: per-model input modalities (text / image) and reasoning configuration (non-reasoning, or effort levels), stored on the route's model entries and merged field-by-field with any concurrent writer — the same fields the official Models settings page edits. Includes one-click reference-value lookup from models.dev (cached, non-blocking), inline manual model add/remove, and clear-to-defaults.
- Model capability saves go through a settings revision guard with bounded retry, so they never clobber concurrent edits to the same route.

### Changed

- **Fully vendor-neutral**: package name `dsh-plugin-relay`, settings namespace `relay`, API prefix `/api/relay/*`, pi-ai route `relay`, credential reference `RELAY_API_KEY`. Works with any new-api-family relay panel (one-api / new-api / Veloera / done-hub / ...).
- Model entries now carry `name: <id>`; generated display names were removed — the pi-ai schema renders an unnamed model as its id anyway.
- Rewritten in TypeScript (tsdown builds the Node host entry and the wrapped browser client; `npm run typecheck` gates).
- Model catalog sync preserves per-model capability configuration and manual capacity edits of surviving ids.
- `@deepseek-ai/schemastery` moved to `peerDependencies` per plugin-ecosystem convention.

### Removed

- The standalone CLI entry — everything lives in the dsh web settings page.

## [0.3.0] - 2026-09-20

### Added

- Keys tab rebuilt: automatic load on section mount, group and group-ratio per key, quota and expiry columns, three pricing dialects in the Models tab.
- Hot reload: switching keys writes credentials, route catalog, and default model through the dsh services, so running sessions pick them up on the next request.

### Fixed

- Key-switch race: settings writes are queued per namespace and every write in a request handler is now awaited before the response returns, so an immediate refetch always reads the new values.

### Removed

- Automatic user-ID detection (removed at the panel operators' request — the paired `New-Api-User` header value is typed manually).

## [0.2.1] - 2026-09-19

### Fixed

- `npm start` anchors the dsh home to the repository's own `.dsh-home`, ignoring an exported `DSH_HOME`.

## [0.2.0] - 2026-09-19

### Changed

- All connection settings (base URL, access token, user ID) moved into the web settings page; any new-api-family panel is supported.

## [0.1.0] - 2026-09-19

### Added

- Initial release: connect dsh to a new-api-family relay panel from the web settings page.
