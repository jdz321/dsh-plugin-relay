# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

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
