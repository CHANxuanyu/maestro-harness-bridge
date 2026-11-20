# B1-1 model catalog contract

Status: B1-1 data/API plus B1-2 through B1-4 new-shell picker integration.
Existing classic-shell `getModels` and `getConfigOptions` consumers keep their
current behavior. Electron acceptance and timing still require an external run.

`ModelEffortPicker` (`src/renderer/components/ModelEffortPicker.tsx`) accepts
`catalog`, `policy: 'conversation' | 'team-seat'`, `model` (empty means native
default), optional `effort`, `remembered`, controlled `open`/`onOpenChange`,
and `onChange(ModelPickerSelection)`. The composer adapter persists through
`tabStore.setTabModelEffort()`. `accountKey` is an opaque hash of the effective
provider/account root, supplied by main even for a local fallback. Use it to
partition memory without exposing account paths. Remote and preset catalogs
may omit it. The mounted adapter warms once and rechecks on each open; file
changes and quota updates still use the existing main cache.

An explicit native default is stored as `NATIVE_MODEL_DEFAULT`, distinct from
an undefined tab override (inherit Maestro owner/provider defaults). Both
spawn transports understand it. Never send the marker to a vendor or display
it as a model name. Unknown custom model IDs remain possible through the filter.

```typescript
const catalog = await window.maestro.agents.getModelCatalog({
	provider: 'codex',
	sessionId: owner.id,
});
```

For an unsaved agent, pass `account: { customEnvVars }` instead of `sessionId`.
Omitting both uses provider-level, global and process environment layers via
the canonical account resolver. An explicitly supplied environment replaces
the provider-level set, matching spawn behavior. Stored identity wins if both
are supplied; a missing agent or mismatched provider rejects the request.
`sshRemoteId` or a stored SSH identity returns `error: 'unsupported-remote'`
without reading any local catalog, default or quota. The old remote discovery
path is unchanged. DeepSeek uses the canonical preset, with no Claude quota.

CLI parity: `maestro-cli models <codex|claude-code> [--agent <id>] [--json]`.
`--account-dir <path>` selects an unsaved account instead; `--ssh-remote <id>`
requests explicit remote status. The CLI requires the running desktop and
invokes the same IPC handler through the existing bridge.

Use `visibleCatalogModels(catalog)` for selectable rows. `catalog.models`
also retains hidden entries for resolving a previously saved model.
Keep vendor order within `group: 'current' | 'more'`. Claude `section` supplies
the legacy group; Codex does not declare one in the observed cache, so no age
heuristic is applied. `description` and effort descriptions are empty when the
vendor supplies none. The UI supplies Chinese explanations and vendor level
labels. IDs remain strings so new levels need no backend change.

`effortsForModel(catalog, modelId)` supplies only that model's ordered levels.
An empty array means hide the effort control. `defaultEffort` is present only
when the model supports that ID. `rememberEffortPerModel(state, model, effort)`
returns an immutable model-ID map; `rememberedEffortForModel(state, model)`
restores a supported choice or the model default. Passing undefined clears the
remembered override. The UI owns persistence and scopes the map by provider,
account and conversation. For team seats, use `teamSeatEfforts(provider, model)`
and validate selection against that result; it removes Codex Ultra without
changing the vendor catalog. Apply this policy again when restoring a saved
team choice. This data layer does not change effort rejection/retry behavior.

`followDefault` identifies the native default, independently of Maestro's
tab/owner/provider override ladder. Codex reads root `config.toml` scalars and
the selected native profile. Without a model setting, it uses the catalog's
priority order and picker visibility (`source: 'catalog-priority'`), following
the [upstream default-selection policy](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs).
Claude reads account `settings.json`, resolves catalog aliases, and otherwise
reports the selected `catalog.state.model` with `source: 'catalog-state'`.
Effective `ANTHROPIC_MODEL` takes precedence and is resolved against aliases.
Unknown custom model IDs are retained. If no native default can be established,
`modelId` is null and `source` is `unresolved`; do not display a guessed model.
Project-local settings, arbitrary custom CLI flags/binaries, custom Codex model
providers and Claude provider-specific alias overrides are not resolved here.

The reader fingerprints file names, mtime, ctime, size and inode, including the
native default config file. Claude excludes `published-floor.json`, considers
only the `cc` surface, and selects the newest readable catalog by file mtime
instead of merging old models into the latest catalog. Both the per-surface
and older published multi-surface envelopes are supported. A corrupt newer
candidate leaves an older readable catalog marked stale with an error. Cache
capacity is bounded; no blind TTL delays native config or catalog edits.

`source.kind` distinguishes vendor files, preset and fallback. `source.files`
are account-relative paths, never credentials or absolute account paths.
`fetchedAt` and `clientVersion` are copied only when present in the vendor file;
Claude's envelope `version` is not a client version. Claude `staleAt` is checked
even on cache hits. `error` describes missing, unreadable, invalid or unsupported
remote data. Fallback reuses existing Claude aliases and provider effort lists.
Codex has no existing static model-ID list, so its fallback model list is empty;
`fallbackEfforts` still exposes the existing static levels. Do not invent IDs.

`quota` is a display-only projection of the latest retained usage-store sample
for the effective local account, read afresh even when catalog files are cached.
Each window has `remainingPercent` and optional `resetsAt`, plus a sample time
and stale flag. Missing/invalid windows or unauthenticated samples are omitted;
missing samples return undefined. Known zero usage means 100% remaining, even
when the vendor omitted a reset time. Retention and the 24-hour stale boundary
reuse the existing stores. Opening the picker never triggers sampling.

Observed Claude field names relevant to this adapter:

- Envelope: `catalog`, `fetchedAt`, `staleAt`, `version`, `organizationUuid`, `resolution`.
- Catalog: `surface`, `config`, `state`.
- Config: `id`, `models`, `provider_alias_targets`, `settings_vocabulary`.
- Model: `id`, `name`, `short_name`, `description`, `tooltip.content`, `section`, `runtime`, `thinking`.
- Runtime: `family`, `effort_levels`, `default_effort`.
- Thinking: `type`, `description`, `effort_options`.
- Effort option: `id`, `name`, `tooltip.content`, `badge`.
- State: `id`, `model`, `selection_source`, `thinking`, `thinking_by_model`.

Fixtures are synthetic. No values or account paths from real catalogs are stored
in the repository. Real vendor inference, packaged-app GUI, SSH typed catalogs
and cross-platform CI are not claimed by the unit suite.
