[English | 中文](README.zh.md)

# dsh-plugin-relay

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that connects dsh to any **new-api-family relay panel** (one-api / new-api / Veloera / done-hub / ...). Everything lives in the dsh web settings page — no CLI, no config files to hand-edit, and no panel-specific defaults baked in.

![API keys](assets/screenshot-keys.png)

## Features

- **Connection** — base URL, access token (write-only), and user ID in the *Connection* tab; saved values hot-reload, and the plugin mirrors connection fields into the dsh route config at runtime.
- **API keys** — the *API keys* tab manages every key of the account: create, edit (name / group / quota / expiry / enable-disable), delete, and switch with one click on *Use*. Editing happens **in place** like the official Models page: the row expands into an editor card (one card at a time), *Apply* writes immediately and keeps the card open on failure, and deletions confirm in a dialog. Key material never crosses to the browser — creation responses are stripped server-side, and *create and set active* runs the regular switch flow so the secret only enters the credential store.
- **Models** — the *Models* tab shows the models the active key can call with pricing, covering all three billing dialects of the panel family: per-token USD prices ($/1M tokens), fixed per-call prices, and classic ratio pricing (model ratio × group ratio). Refreshing the list syncs it into dsh so running sessions pick it up immediately.
- **Dashboard** — the *Dashboard* tab shows balance, today's spend, totals, and a stacked per-model usage chart of the last 7 days with a spend/tokens toggle; the four summary cards always sit in one row. Panels keep only recent usage buckets, so sparse data renders as a readable empty state.
- **Usage logs** — the *Usage logs* tab lists panel request logs with a usage/RPM/TPM header, time / model / key / group filters (applied on query), and per-request usage including cache and reasoning tokens plus first-response time.
- **Capabilities** — the *Capabilities* tab combines a **preset knowledge base** (compiled in from [models.dev](https://models.dev) mainstream providers plus the panel's own public model list — models released within the last ~6 months only; refreshable online with one button inside the preset panel) with your own entries and per-id overrides. Every section edits **in place** like the official Models page — one row expands into an editor card, *Done* saves immediately, there is no global save button. Context windows accept `128K` / `1M` shorthand (1024-based) with a live conversion hint. Matching follows the same rule as syncs: override → knowledge base (exact id → stripped variant suffix) → untouched, with the matched name shown under the model id.
- **Hot reload** — credentials, model catalog, and capability config all go through the dsh settings/credentials services; a running session applies them on its next request, no restart. The plugin does **not** manage a default model — pick one in dsh itself.

## Screenshots

| Connection | API keys | Models |
| --- | --- | --- |
| ![Connection](assets/screenshot-connection.png) | ![API keys](assets/screenshot-keys.png) | ![Models](assets/screenshot-models.png) |
| **Dashboard** | **Usage logs** | **Capabilities** |
| ![Dashboard](assets/screenshot-dashboard.png) | ![Usage logs](assets/screenshot-logs.png) | ![Capabilities](assets/screenshot-capabilities.png) |

## Install

Requires Node ≥ 20 and pnpm on PATH (dsh installs plugins through pnpm).

```sh
# from npm (once published)
dsh plugin --profile web add dsh-plugin-relay

# or from a local clone
npm install && npm run build
dsh plugin --profile web add /path/to/dsh-plugin-relay
```

Install into the `headless` profile the same way (`--profile headless`) if you use headless sessions. Then restart `dsh web` and open **Settings → Relay**.

## Usage

1. Open **Settings → Relay → Connection**, fill in the panel origin (no `/v1` suffix), the access token from the panel's personal page (client token / access token), and the user ID shown on the same page, then save.
2. On **API keys**, create a key if you don't have one (or press *Use* on an existing one). The plugin writes the key into the dsh credential store, builds the model route (`openai-completions` at `<panel>/v1`), and syncs the key's model catalog. dsh's own model picker chooses the model per session — the plugin stays out of it.
3. On **Models**, review pricing per model; refreshing keeps dsh's route catalog in step with what the key can actually call.
4. On **Dashboard** and **Usage logs**, keep an eye on balance and consumption; both read the panel's reporting APIs read-only.
5. On **Capabilities**, browse the preset entries (searchable, collapsed by default) and copy any of them into *My entries* when you need a tweak; a single *Refresh presets* button re-fetches models.dev for the newest values. Context windows take `131072`, `128K`, or `1M` alike. Edit a platform-model card only when a specific id needs different values — *Done* saves it right away.

## How it works

- The plugin registers a `relay` settings namespace (token stored as a secret field; your capability entries and overrides live there too) and serves `/api/relay/{state,keys,keys-create,keys-update,keys-delete,use,models,capabilities,model-info,knowledge-refresh,dashboard,logs,logs-stat,logs-meta}` inside dsh's authenticated web fence.
- On first key switch it writes the pi-ai route profile (`api: openai-completions`, `baseURL: <panel>/v1`, `apiKeyEnv: RELAY_API_KEY`, merged model catalog) into dsh's settings — dsh hot-reloads routes, so no restart. The API key itself resolves per request from the credential reference (default `RELAY_API_KEY`).
- Catalog sync merges by model id: manual edits of surviving ids are preserved; ids the key lost are removed, so dsh only offers models the key can call. Capability fields on the entries are **derived state**: each sync and each capability save replays the overrides → knowledge base (yours first, then the preset layer) over them. Only fields the plugin holds config for are written — anything you edit on the official Models page for unconfigured ids survives.
- Capability saves are **directed operations** (`catalogSet` / `catalogDelete` / `overrideSet` / `overrideDelete`) applied as per-entry settings path ops — deletions are real, not masked by deep merges — followed by one revision-guarded replay over the route catalog.
- The preset knowledge base is generated at build time by `npm run preset:fetch` (models.dev mainstream providers ∪ the panel's **public** `/api/pricing` model list — no credentials involved) and committed into the source; the *Refresh presets* button rebuilds it in host memory from a live models.dev fetch, and a restart deliberately falls back to the compiled baseline.

## Security notes

- The relay access token lives in a secret settings field (redacted on the wire); API keys are written only to the server-side credential store (`.credentials.yaml`, 0600) and never returned to the browser — key creation responses are stripped server-side, and no "copy key" feature exists.
- All plugin routes sit inside dsh's browser trust fence (same origin + signed session); unauthenticated requests get 401.
- The models.dev lookup runs host-side (cached, single-flight); the browser never talks to third parties directly. The preset build script reads only the panel's public `/api/pricing` endpoint and never touches credentials.

## Compatibility

- Requires dsh ≥ **0.1.5-rc.2** (`engines.dsh` enforces it) — that is the first host whose frozen browser module table ships `@deepseek-ai/dsh-client-ui-primitives`, which this plugin's UI consumes at runtime (the host supplies its own compiled copy; the package is not a runtime dependency — it is installed as a devDependency **pinned to the host-matching version** for types only, since the npm `latest` tag stays at an early rc even though version-matched builds publish in lockstep).
- Browser-tested against dsh **0.1.5-rc.2** and **0.1.5-rc.3** (the current npm line). The primitives subset this plugin uses (Button / Switch / Pill / Tag / StateDot / Menu / Modal) was diff-verified compatible through the **0.1.7-rc.1** git tag.
- The plugin deliberately sticks to that stable subset and re-runs a browser walkthrough whenever the dsh dev dependency is upgraded (see docs/PUBLISHING.md).

## Known limitations

- Management-API calls need the paired user ID (typed once; see the panel's personal page).
- Model capacity falls back to id-prefix heuristics when neither the panel nor the knowledge base reports a context window; unknown ids fall back to 131072 / 8192.
- Knowledge-base matching strips up to two trailing `-variant` suffixes; channel-named panel-specific models (e.g. `grok-video`) match nothing by design.
- The preset refresh lives in host memory only — by design, a restart falls back to the compiled baseline; persisting a new baseline is `npm run preset:fetch`'s job.
- Panels keep only recent usage-log detail and dashboard buckets; older data is the panel's retention policy, not a plugin bug.
- models.dev is a third-party snapshot — unlisted models and toggle-style reasoning fall back to manual configuration.
- Context-window shorthand is 1024-based (`128K` = 131072); a few vendors advertise decimal sizes (e.g. 200K = 200000), so check the live conversion hint before saving.

## Development

```sh
npm install        # @deepseek-ai/dsh is a devDependency; runtime has zero dependencies (schemastery is a peer)
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js (host ESM) + lib/client.js (wrapped browser bundle)
npm test           # vitest: unit tests + mock relay panel, never touches a real dsh home
npm start          # dev launcher: dsh web --port 3098 against this repo's .dsh-home
npm start -- --no-open   # same, without opening the system browser
npm run preset:fetch    # regenerate src/knowledge-preset.generated.ts (panel public pricing ∪ models.dev)
```

See [CHANGELOG.md](CHANGELOG.md) for release history, [docs/](docs) for development notes (worklog, specs, publishing checklist), and [AGENTS.md](AGENTS.md) for dsh integration semantics.

## License

[MIT](LICENSE)
