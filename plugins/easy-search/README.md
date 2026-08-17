# Easy Search

Easy Search is an independently installable DeepSeek Harness bundle in the
[Easy DSH Plugins](../..) collection. It provides a focused research layer over
AIsa search APIs.

The collection root is not a package. Easy Search owns this directory and does
not depend at runtime on the legacy AIsa marketplace plugin.

## What it adds

- easy_search searches the web, X, YouTube, and Scholar in one call.
- easy_extract retrieves clean Markdown from one to three known public URLs.
- Native DSH web cards render search citations and single-page extraction.
- Per-source coverage makes partial failures visible without discarding results
  from healthy sources.
- Settings and Credentials remain owned by DeepSeek Harness.

The plugin exposes only the two research tools above. It does not add a second
chat UI, permission system, account store, or browser application.

## Requirements

- Node.js 22 or newer
- DeepSeek Harness 0.1.0-rc.6 compatible packages
- An AIsa API key

## Install

### From GitHub

Pin a reviewed commit for production:

~~~sh
dsh plugin --profile web add \
  "AIsa-plugins/easy-dsh-plugin#<commit>&path:/plugins/easy-search"
dsh --profile web --dump-config
~~~

The path parameter selects this package from the collection; the collection
root itself is not a DSH bundle.

### From a source checkout

From the collection root:

~~~sh
pnpm install --frozen-lockfile
pnpm --filter @aisa-plugins/easy-search check
dsh plugin --profile web add ./plugins/easy-search
dsh --profile web --dump-config
~~~

The package ships its compiled lib directory, so installation does not execute
a build script. Use another profile name if your Harness deployment does not
use web.

## Configure

Open the Harness Settings surface and select Easy Search. The default
credential reference is AISA_API_KEY. Store the API key through the native
Credentials control for that reference, or provide it through a supported DSH
credential source.

Configuration contains only the reference. The secret value is resolved once
at the start of each Easy Search or Easy Extract operation and is never placed
in a tool argument, result, presentation payload, or settings document.

| Setting | Default | Purpose |
| --- | --- | --- |
| API key reference | AISA_API_KEY | DSH CredentialRef resolved per operation |
| Base URL | https://api.aisa.one | AIsa HTTP origin |
| Request timeout | 30000 ms | Per-request cooperative timeout |
| Response limit | 5 MiB | Maximum upstream response bytes |
| Default results | 5 | Results retained per selected source |
| Maximum results | 10 | User-selectable per-source ceiling |
| Snippet limit | 1200 chars | Maximum normalized result preview |
| Extract limit | 100000 chars | Maximum content retained per page |

Settings changes are read at operation time and do not require the plugin to
cache credentials or API configuration.

## Search sources

| Source | AIsa endpoint | Notes |
| --- | --- | --- |
| web | Tavily Search | Optional answer plus citeable pages |
| x | X Advanced Search | Latest or Top ordering |
| youtube | YouTube Search | Videos, channels, and playlists |
| scholar | Scholar Web Search | Optional publication-year range |

Selected sources run concurrently. One failed source becomes an error entry in
coverage while successful siblings remain available to the model.

Easy Extract accepts only credential-free HTTP or HTTPS URLs. Literal local,
private, link-local, multicast, and IPv4-mapped private addresses are rejected
before the upstream request.

## Native presentation

The canonical tool value remains structured JSON for validation and replay.
The model receives compact citeable text, while presentationMeta projects only
the fields needed by the official DSH web cards. Provider payloads and secrets
do not enter presentation metadata.

## Development

From the collection root:

~~~sh
pnpm install
pnpm --filter @aisa-plugins/easy-search typecheck
pnpm --filter @aisa-plugins/easy-search test
pnpm --filter @aisa-plugins/easy-search build
pnpm --filter @aisa-plugins/easy-search check
pnpm --dir plugins/easy-search pack --dry-run
~~~

The test suite locks down current AIsa endpoint shapes, credential handling,
response limits, partial-source failure, extraction URL boundaries, and DSH
presentation behavior.

## Repository layout

~~~text
plugins/easy-search/
├── src/
│   ├── client.ts
│   ├── config.ts
│   ├── index.ts
│   ├── normalize.ts
│   ├── search.ts
│   ├── tools.ts
│   └── types.ts
├── tests/
├── docs/
│   └── architecture.md
├── cordis.patch.yml
└── package.json
~~~

See docs/architecture.md for the dependency boundaries and extension rules.

## License

MIT
