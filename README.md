[English | 中文](README.zh.md)

# dsh-plugin-relay

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that connects dsh to any **new-api-family relay panel** (one-api / new-api / Veloera / done-hub / ...). Everything lives in the dsh web settings page — no CLI, no config files to hand-edit, and no panel-specific defaults baked in.

![API keys](assets/screenshot-keys.png)

## Features

- **Connection** — base URL, access token (write-only), and user ID in the *Connection* tab; saved values hot-reload, and the plugin mirrors connection fields into the dsh route config at runtime.
- **API keys** — the *API keys* tab manages every key of the account: create, edit (name / group / quota / expiry / enable-disable), delete, and switch with one click on *Use*. Key material never crosses to the browser — creation responses are stripped server-side, and *create and set active* runs the regular switch flow so the secret only enters the credential store. Deleting the active key warns; so does switching to a disabled one.
- **Models** — the *Models* tab shows the models the active key can call with pricing, covering all three billing dialects of the panel family: per-token USD prices ($/1M tokens), fixed per-call prices, and classic ratio pricing (model ratio × group ratio). Refreshing the list syncs it into dsh so running sessions pick it up immediately.
- **Dashboard** — the *Dashboard* tab shows balance, today's spend, totals, and a stacked per-model usage chart of the last 7 days with a spend/tokens toggle. Panels keep only recent usage buckets, so sparse data renders as a readable empty state.
- **Usage logs** — the *Usage logs* tab lists panel request logs with a usage/RPM/TPM header, time / model / key / group filters (applied on query), and per-request usage including cache and reasoning tokens plus first-response time.
- **Capabilities** — the *Capabilities* tab maintains a capability **knowledge base** that never changes with key switches: per canonical model name (models.dev naming), input modalities, reasoning, and default context window. Per-panel-id overrides take precedence, and syncs apply it to the route entries by matching rule (exact id → stripped variant suffix → untouched). Reference values come from [models.dev](https://models.dev) with one click.
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
5. On **Capabilities**, maintain the knowledge base once (↻ fetches defaults from models.dev, including the context window); edit individual panel-model cards only when a specific id needs different values.

## How it works

- The plugin registers a `relay` settings namespace (token stored as a secret field; the knowledge base and overrides live there too) and serves `/api/relay/{state,keys,keys-create,keys-update,keys-delete,use,models,capabilities,model-info,dashboard,logs,logs-stat,logs-meta}` inside dsh's authenticated web fence.
- On first key switch it writes the pi-ai route profile (`api: openai-completions`, `baseURL: <panel>/v1`, `apiKeyEnv: RELAY_API_KEY`, merged model catalog) into dsh's settings — dsh hot-reloads routes, so no restart. The API key itself resolves per request from the credential reference (default `RELAY_API_KEY`).
- Catalog sync merges by model id: manual edits of surviving ids are preserved; ids the key lost are removed, so dsh only offers models the key can call. Capability fields on the entries are **derived state**: each sync replays the knowledge base and overrides over them. Only fields the plugin holds config for are written — anything you edit on the official Models page for unconfigured ids survives.
- Capability saves and catalog syncs go through a settings revision guard with bounded retry, so concurrent writers never clobber each other.

## Security notes

- The relay access token lives in a secret settings field (redacted on the wire); API keys are written only to the server-side credential store (`.credentials.yaml`, 0600) and never returned to the browser — key creation responses are stripped server-side, and no "copy key" feature exists.
- All plugin routes sit inside dsh's browser trust fence (same origin + signed session); unauthenticated requests get 401.
- The models.dev lookup is proxied through the host route (cached, single-flight); the browser never talks to third parties directly.

## Known limitations

- Management-API calls need the paired user ID (typed once; see the panel's personal page).
- Model capacity falls back to id-prefix heuristics when neither the panel nor the knowledge base reports a context window; unknown ids fall back to 131072 / 8192.
- The knowledge-base matching strips up to two trailing `-variant` suffixes; channel-named panel-specific models (e.g. `grok-video`) match nothing by design.
- Panels keep only recent usage-log detail and dashboard buckets; older data is the panel's retention policy, not a plugin bug.
- models.dev is a third-party snapshot — unlisted models and toggle-style reasoning fall back to manual configuration.

## Development

```sh
npm install        # @deepseek-ai/dsh is a devDependency; runtime has zero dependencies (schemastery is a peer)
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js (host ESM) + lib/client.js (wrapped browser bundle)
npm test           # vitest: unit tests + mock relay panel, never touches a real dsh home
npm start          # dev launcher: dsh web --port 3098 against this repo's .dsh-home
npm start -- --no-open   # same, without opening the system browser
```

See [CHANGELOG.md](CHANGELOG.md) for release history, [docs/](docs) for development notes (worklog, specs, publishing checklist), and [AGENTS.md](AGENTS.md) for dsh integration semantics.

## License

[MIT](LICENSE)
