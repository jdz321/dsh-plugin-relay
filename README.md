[English | 中文](README.zh.md)

# dsh-plugin-relay

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that connects dsh to any **new-api-family relay panel** (one-api / new-api / Veloera / done-hub / ...). Everything lives in the dsh web settings page — no CLI, no config files to hand-edit, and no panel-specific defaults baked in.

![API keys](assets/screenshot-keys.png)

## Features

- **Connection** — base URL, access token (write-only), and user ID in the *Connection* tab; saved values hot-reload, and the plugin mirrors connection fields into the dsh route config at runtime.
- **API keys** — the *API keys* tab lists every key of the account (name, group, group ratio, quota, expiry — **never key material**). One click on *Use* makes a key active; switching also syncs that key's model catalog and the default model. Switching to a disabled key warns before it matters.
- **Models** — the *Models* tab shows the models the active key can call with pricing, covering all three billing dialects of the panel family: per-token USD prices ($/1M tokens), fixed per-call prices, and classic ratio pricing (model ratio × group ratio). Refreshing the list syncs it into dsh so running sessions pick it up immediately.
- **Capabilities** — the *Capabilities* tab configures per-model input modalities (text / image) and reasoning behavior (explicitly non-reasoning, or effort levels). It writes the same per-model fields the official *Models* settings page edits, merged field-by-field so neither writer clobbers the other. Reference values can be fetched from [models.dev](https://models.dev) with one click; models can also be added or removed manually.
- **Hot reload** — credentials, model catalog, default model, and capability config all go through the dsh settings/credentials services; a running session applies them on its next request, no restart.

## Screenshots

| Connection | API keys |
| --- | --- |
| ![Connection](assets/screenshot-connection.png) | ![API keys](assets/screenshot-keys.png) |
| **Models** | **Capabilities** |
| ![Models](assets/screenshot-models.png) | ![Capabilities](assets/screenshot-capabilities.png) |

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
2. On **API keys**, pick a key and press *Use*. The plugin writes the key into the dsh credential store, builds the model route (`openai-completions` at `<panel>/v1`), syncs the key's model catalog, and sets the default model.
3. On **Models**, review pricing per model; refreshing keeps dsh's route catalog in step with what the key can actually call.
4. On **Capabilities**, fine-tune per-model modalities and reasoning efforts if needed — optional; unconfigured models follow the route defaults.

## How it works

- The plugin registers a `relay` settings namespace (token stored as a secret field) and serves `/api/relay/{state,keys,use,models,capabilities,model-info}` inside dsh's authenticated web fence.
- On first key switch it writes the pi-ai route profile (`api: openai-completions`, `baseURL: <panel>/v1`, `apiKeyEnv: RELAY_API_KEY`, merged model catalog) into dsh's settings — dsh hot-reloads routes, so no restart. The API key itself resolves per request from the credential reference (default `RELAY_API_KEY`).
- Catalog sync merges by model id: capability config and manual edits of surviving ids are preserved; ids the key lost are removed, so dsh only offers models the key can call.
- Capability saves go through a settings revision guard with bounded retry and only touch the capability fields — concurrent edits from any writer survive.

## Security notes

- The relay access token lives in a secret settings field (redacted on the wire); API keys are written only to the server-side credential store (`.credentials.yaml`, 0600) and never returned to the browser.
- All plugin routes sit inside dsh's browser trust fence (same origin + signed session); unauthenticated requests get 401.
- The models.dev lookup is proxied through the host route (cached, single-flight); the browser never talks to third parties directly.

## Known limitations

- Management-API calls need the paired user ID (typed once; see the panel's personal page).
- Model context window / max output use id-prefix heuristics when the panel doesn't report them; unknown ids fall back to 131072 / 8192. Manual corrections are never overwritten.
- Prices and quotas are shown in the panel's own terms; the ¥ figure is a panel-side estimate.
- models.dev is a third-party snapshot — unlisted models and toggle-style reasoning fall back to manual configuration.

## Development

```sh
npm install        # @deepseek-ai/dsh is a devDependency; runtime has zero dependencies (schemastery is a peer)
npm run typecheck  # tsc --noEmit
npm run build      # tsdown → lib/index.js (host ESM) + lib/client.js (wrapped browser bundle)
npm test           # vitest: unit tests + mock relay panel, never touches a real dsh home
npm start          # dev launcher: dsh web --port 3098 against this repo's .dsh-home
```

See [CHANGELOG.md](CHANGELOG.md) for release history, [docs/](docs) for development notes (worklog, v0.4.0 spec, publishing checklist), and [AGENTS.md](AGENTS.md) for dsh integration semantics.

## License

[MIT](LICENSE)
