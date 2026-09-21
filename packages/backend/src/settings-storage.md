# Settings storage classification

BurnGuard exposes one effective `AppConfig`, but persists portable preferences separately from OS-local state. Unknown keys are deliberately discarded when either canonical file is rewritten; they are never propagated between operating systems.

## Shared portable (`config.json`, schemaVersion 1)

| Setting | Reason |
|---|---|
| `generationDefaults` | User generation preference |
| `defaultBackend` | User default provider choice |
| `theme` | User appearance preference |
| `locale` | User language preference; nullable only until an older browser-local choice is lazily published |
| `chat.abortThresholdMs` | Legacy user-facing behavior retained for compatibility |
| `chat.contextMode` | User context preference |
| `user.displayName` | User profile preference |

## OS-local (`config.local.<process.platform>.json`, schemaVersion 1 + exact `platform`)

| Setting | Reason |
|---|---|
| `commandcodeApiKey` | Secret credential |
| `llmApiKeys.{gemini,deepseek,xai}` | Secret credentials |
| `figmaPersonalAccessToken` | Secret credential |
| `port` | Host networking policy |
| `autoOpenBrowser` | Host launch policy |
| `playwright.installed`, `playwright.installPath` | Legacy host installation state/path |
| `harness.maxConcurrentSessions`, `checkpointEveryTurns`, `toolAutoAllow` | Host capacity/security policy |
| `logs.level` | Host diagnostics policy |

## Runtime-only and already-local state

- `user.id` is always the runtime sentinel `local`; `appVersion` always comes from `APP_VERSION`.
- CLI executable paths/authentication remain in their external homes.
- Python/browser/update/font capability state remains in its existing local runtime storage.
- Creation, export, composer, and attachment drafts remain local/private and are not settings transport.

## Migration and failure semantics

An unversioned legacy `config.json` is split by the first OS that migrates it. Local state is written and fsynced first with a temporary `pendingShared` snapshot, then shared state is published, then the pending marker is removed. Restart publishes a valid pending snapshot idempotently. An existing current-platform local file is authoritative for local values. Other platform files are never opened or changed. Corrupt JSON, unsupported schema versions, and current-file platform mismatch fail closed without overwriting bytes.

The two-file update is recoverable, not transactionally atomic: failure after the local write leaves `pendingShared` for restart recovery. API GET/PATCH continue returning one effective config and expose credentials only as set/not-set booleans.
