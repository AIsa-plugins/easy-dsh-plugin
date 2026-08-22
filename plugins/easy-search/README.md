# Easy Search

Easy Search is an independently installable DeepSeek Harness bundle in the
[Easy DSH Plugins](../..) collection. It adds provider-neutral search and page
extraction tools while leaving settings, credentials, execution, replay, and UI
ownership with Harness.

The plugin supports both an AIsa One Key and users' own provider credentials:

- `aisa` routes every capability through AIsa.
- `byok` calls each upstream provider directly.
- `hybrid` prefers a configured direct credential and otherwise uses AIsa.

Hybrid routing falls back only when a direct credential is absent. It never
replays a failed request through another provider.

## What it adds

- `easy_search` searches the web, X, YouTube, and Scholar concurrently.
- `easy_extract` retrieves clean Markdown from one to three public URLs.
- Per-source provider and coverage metadata make partial failures explicit.
- Native DSH web cards render citations and single-page extraction results.
- Credentials are resolved once per tool operation and never enter tool input,
  output, presentation metadata, or settings documents.

The collection root is a catalog, not a package. Easy Search owns this directory
and has no runtime dependency on the legacy AIsa marketplace plugin.

## Requirements

- Node.js 22 or newer
- DeepSeek Harness 0.1.0-rc.6 compatible packages
- Credentials for the selected routing mode

## Install

### From npm

Install the published bundle into the profile that runs Harness:

~~~sh
dsh plugin --profile web add @aisa-plugins/easy-search
dsh --profile web --dump-config
~~~

Use another profile name if your Harness deployment does not use `web`.

### From a source checkout

~~~sh
pnpm install --frozen-lockfile
pnpm --filter @aisa-plugins/easy-search check
dsh plugin --profile web add ./plugins/easy-search
dsh --profile web --dump-config
~~~

The package ships its compiled `lib` directory, so installation does not run a
build script.

## Routing

Easy Search registers an `easy-search` namespace with the official DSH
Settings service. In DSH `0.1.0-rc.6`, the Web settings API intentionally
exposes only model providers and a small product allowlist, so third-party
namespaces do not yet appear in the Settings page.

For a per-profile deployment default, add an override to
`$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

~~~yaml
- id: easy-search
  config:
    routingMode: hybrid
~~~

The profile patch replaces the row's complete `config` value; omitted fields
still receive Easy Search's schema defaults. DSH watches this file and applies
valid edits live.

For a user-layer override shared by profiles under the same DSH home, edit
`$DSH_HOME/settings.yaml` instead:

~~~yaml
easy-search:
  routingMode: hybrid
~~~

This file is also watched and applied live. Do not edit the plugin's installed
`cordis.patch.yml`; an update is allowed to replace package-owned files.

| Mode | Selection rule | Missing credential | Request failure |
| --- | --- | --- | --- |
| `aisa` | Always AIsa | Operation fails | No provider switch |
| `byok` | Always direct | Capability fails | No provider switch |
| `hybrid` | Direct key if configured, otherwise AIsa | Falls back to AIsa | No provider switch |

The default is `aisa`, preserving the simplest One Key setup. Choose `hybrid`
when some users supply direct keys but AIsa should cover the remaining sources.
Choose `byok` when every capability must use its native provider.

## Credentials

Settings contain credential references, not secret values. Store each value in
the DSH credential provider under the matching reference. With the standard
local provider, use `$DSH_HOME/.credentials.yaml`:

~~~yaml
AISA_API_KEY: your-one-key
TAVILY_API_KEY: your-tavily-key
X_BEARER_TOKEN: your-x-bearer-token
YOUTUBE_API_KEY: your-youtube-key
SERPAPI_API_KEY: your-serpapi-key
~~~

Keep only the entries needed by the selected mode and preserve any credentials
already in the file. The standard provider requires the document to be mode
`0600` inside an owner-only DSH home. A launch-time environment variable with
the same name takes precedence and requires a restart when changed.

| Capability | Direct provider | Default reference |
| --- | --- | --- |
| All AIsa routes | AIsa | `AISA_API_KEY` |
| Web search and extraction | Tavily | `TAVILY_API_KEY` |
| X search | X API v2 | `X_BEARER_TOKEN` |
| YouTube search | YouTube Data API v3 | `YOUTUBE_API_KEY` |
| Scholar search | SerpApi Google Scholar | `SERPAPI_API_KEY` |

One immutable credential snapshot is shared by all requests in a single tool
operation. A later operation resolves credentials again, so settings changes do
not require a plugin restart.

Credential references are scoped to the DSH deployment, not to an individual
browser session. Separate tenant secrets therefore require separate DSH homes
or another credential provider; Easy Search does not add its own secret store.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| Routing mode | `aisa` | `aisa`, `byok`, or `hybrid` |
| AIsa key reference | `AISA_API_KEY` | One Key credential |
| AIsa base URL | `https://api.aisa.one` | Origin used only for AIsa routes |
| Tavily key reference | `TAVILY_API_KEY` | Direct web and extraction |
| X token reference | `X_BEARER_TOKEN` | Direct X recent search |
| YouTube key reference | `YOUTUBE_API_KEY` | Direct YouTube search |
| SerpApi key reference | `SERPAPI_API_KEY` | Direct Scholar search |
| Request timeout | 30000 ms | Per-request cooperative timeout |
| Response limit | 5 MiB | Maximum upstream response bytes |
| Default results | 5 | Results retained per selected source |
| Maximum results | 10 | User-selectable per-source ceiling |
| Snippet limit | 1200 chars | Maximum normalized preview |
| Extract limit | 100000 chars | Maximum retained content per page |

The AIsa base URL must be a credential-free HTTP(S) origin. Direct provider
origins are fixed by their adapters and cannot be supplied through tool input.

## Provider contracts

| Source | AIsa route | Direct route |
| --- | --- | --- |
| Web | Tavily-compatible AIsa API | Tavily Search |
| X | AIsa X Advanced Search | X API v2 recent search |
| YouTube | AIsa YouTube Search | YouTube Data API v3 |
| Scholar | AIsa Scholar Search | SerpApi Google Scholar |
| Extract | Tavily-compatible AIsa API | Tavily Extract |

Provider payloads are normalized behind one stable domain model. Selected
search sources run concurrently; one failed source becomes an error entry in
`coverage` while successful siblings remain available to the model.

`easy_extract` accepts only credential-free HTTP(S) URLs. Literal local,
private, link-local, multicast, and IPv4-mapped private addresses are rejected
before any provider request.

## Native presentation

The canonical tool value remains structured JSON for validation and replay.
The model receives compact citeable text, while `presentationMeta` projects
only fields required by official DSH web cards. Raw provider payloads and
credentials do not enter presentation data.

## Development

~~~sh
pnpm install
pnpm --filter @aisa-plugins/easy-search typecheck
pnpm --filter @aisa-plugins/easy-search test
pnpm --filter @aisa-plugins/easy-search build
pnpm --filter @aisa-plugins/easy-search check
pnpm --dir plugins/easy-search pack --dry-run
~~~

The tests lock down routing policy, official HTTP contracts, credential
snapshots, response normalization, partial-source failure, extraction URL
boundaries, response limits, and native DSH presentation.

## Repository layout

~~~text
plugins/easy-search/
├── src/
│   ├── providers/
│   │   ├── aisa.ts
│   │   ├── tavily.ts
│   │   ├── x.ts
│   │   ├── youtube.ts
│   │   ├── serpapi.ts
│   │   ├── router.ts
│   │   ├── runtime.ts
│   │   └── contracts.ts
│   ├── config.ts
│   ├── index.ts
│   ├── normalize.ts
│   ├── search.ts
│   ├── tools.ts
│   └── types.ts
├── tests/
├── docs/architecture.md
├── cordis.patch.yml
└── package.json
~~~

See [docs/architecture.md](docs/architecture.md) for dependency boundaries and
extension rules.

## License

MIT
