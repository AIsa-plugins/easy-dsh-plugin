# Architecture

## Package boundary

Easy Search is one independently installable DeepSeek Harness bundle under
plugins/easy-search. The collection root is a catalog and pnpm workspace, not a
bundle and not a runtime dependency.

This package's src/index.ts is the composition boundary. It connects DSH
Settings, Credentials, Tools, and System Prompt services to the Easy Search
domain while the remaining modules stay independent of the collection layout.

The legacy marketplace implementation is migration input only. No runtime code,
compatibility adapter, or dependency points back to it.

## Dependency direction

~~~text
src/index.ts
  -> config
  -> AisaClient
  -> EasySearchService
  -> DSH tool registration

tools
  -> service
  -> normalized domain types

service
  -> client port
  -> normalizers
  -> configuration
  -> domain types

client
  -> configuration
  -> AIsa request types

normalizers
  -> configuration limits
  -> normalized domain types
~~~

Dependencies point inward toward stable search concepts. HTTP response shapes
do not escape the normalizer, and DSH presentation concepts do not enter the
client or orchestration layers.

## Responsibilities

### config.ts

This is the configuration authority. It declares the DSH Settings schema,
normalizes the base origin, enforces numeric bounds, and verifies relationships
between defaults and ceilings.

### client.ts

This is the AIsa transport adapter. It owns fixed endpoint paths, HTTP methods,
query and body encoding, authorization headers, request timeout composition,
response-byte limits, JSON decoding, and HTTP errors.

AisaClient.start resolves the configured CredentialRef exactly once. The
resulting AisaOperation shares that immutable credential and configuration
snapshot across every source selected for one tool call. Nothing is cached
between operations.

### normalize.ts

This is the anti-corruption layer between current AIsa responses and stable
Easy Search values. Each source has one strict normalizer. Provider-only fields
are discarded here; model-facing code never branches on raw provider objects.

Optional fields are parsed once before object assembly. This keeps strict
optional-property semantics explicit and prevents repeated coercion.

### search.ts

This is the application service. It validates tool-level options, applies
public-URL rules, dispatches selected sources concurrently, and combines
settled source outcomes into results plus explicit coverage.

Promise.allSettled is intentional. A source outage is data about coverage, not
a reason to erase healthy sibling results.

### tools.ts

This is the DSH adapter. It owns the two public schemas, compact model-facing
rendering, replay-safe presentation metadata, native web cards, concurrency
declaration, and System Prompt guidance.

The canonical return value is validated structured JSON. render and
presentationMeta are pure projections of that value. No provider response or
credential is persisted for presentation.

### index.ts

This is the composition root. It installs the easy-search Settings namespace,
resolves the current configuration at operation time, adapts DSH Credentials
to AisaClient, creates the service, and registers its tools.

## Operation flow

~~~text
model calls easy_search
  -> DSH validates arguments
  -> service validates domain options
  -> client resolves one credential snapshot
  -> selected fixed AIsa requests run concurrently
  -> each successful response is normalized
  -> service combines results and coverage
  -> DSH validates the canonical output
  -> render produces model-facing citations
  -> presentationMeta produces a native web-card payload
~~~

easy_extract follows the same boundary but performs one Tavily Extract request
for a validated set of one to three URLs.

## Invariants

- Public tools cannot supply an API origin or endpoint path.
- The configured base URL must be a credential-free HTTP or HTTPS origin.
- Credentials exist only inside one AisaOperation and authorization headers.
- Authorization values never enter canonical output, rendered text, or
  presentation metadata.
- Upstream response bytes and retained text are independently bounded.
- Parent cancellation and configured timeouts reach every fetch.
- Scholar parameters remain in the query string even though its method is POST.
- YouTube always sends engine=youtube.
- A failed selected source always appears in coverage.
- Extract URLs cannot contain credentials or literal local/private addresses.
- DSH remains the authority for settings, credentials, execution, replay, and UI.

## Extension rules

Adding a search source should change the source union, its request type, one
client method, one normalizer, the service dispatch switch, the public tool
schema, and contract tests. It should not add a second plugin entry or leak the
provider response into generic orchestration.

A genuinely different capability belongs in a sibling directory under plugins
and owns its manifest, dependencies, tests, documentation, and release
lifecycle. Shared code should become a library only after two concrete plugins
need the same stable abstraction.

Avoid compatibility branches for response shapes that the current official
AIsa contract no longer emits. Contract changes should be explicit, tested, and
removed cleanly when obsolete.

## Why there is no custom frontend

Search results already fit the official DSH web presentation contract. A custom
browser surface would duplicate session, replay, and result-card behavior while
coupling this package to one UI build. Easy Search therefore contributes native
tool presentation only and lets DeepSeek Harness own the interaction surface.
