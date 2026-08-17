# Architecture

## Package boundary

Easy Search is one independently installable DeepSeek Harness bundle under
`plugins/easy-search`. The collection root is a catalog and pnpm workspace, not
a bundle or runtime dependency.

`src/index.ts` is the composition root. It connects official DSH Settings,
Credentials, Tools, and System Prompt services to the provider-neutral search
domain. No code modifies Harness itself, so Harness and this plugin can be
upgraded independently.

The namespace registration is a host-side settings seam, not a promise that a
particular client renders it. DSH `0.1.0-rc.6` deliberately filters arbitrary
third-party namespaces from its Web settings API. Operators can still supply
the composition base through profile patches and the user layer through
`$DSH_HOME/settings.yaml`; a future official exposure mechanism can render the
same schema without changing the search domain.

The legacy marketplace implementation is migration input only. There is no
runtime adapter, compatibility branch, or dependency pointing back to it.

## Dependency direction

~~~text
index.ts (DSH composition)
  -> config
  -> provider client
  -> application service
  -> tool adapter

tools.ts (DSH boundary)
  -> application service
  -> normalized domain types

search.ts (application service)
  -> provider operation port
  -> configuration
  -> normalized domain types

providers/router.ts (policy and composition)
  -> provider contracts
  -> AIsa and direct adapters
  -> shared provider runtime

provider adapters
  -> shared HTTP and credential runtime
  -> strict response normalizers

normalize.ts
  -> configuration limits
  -> normalized domain types
~~~

Dependencies point inward toward stable search concepts. Provider request and
response shapes do not escape their adapters. DSH presentation concepts do not
enter provider or application layers.

## Responsibilities

### `config.ts`

The configuration authority declares the DSH Settings schema, routing modes,
credential references, the AIsa origin, and bounded output limits. The resolved
configuration groups credential references by provider without storing any
secret values.

The public configuration intentionally does not retain the old `apiKeyEnv` and
`baseUrl` fields. Provider-aware names make the new contract explicit.

### `providers/contracts.ts`

This module defines the narrow ports consumed by routing and orchestration:

- `SourceProvider` searches one normalized source.
- `ExtractProvider` extracts normalized documents.
- `ProviderOperation` is the per-tool-call interface used by the service.

Provider-specific request types and raw payloads are absent from these ports.

### `providers/runtime.ts`

The shared runtime owns concerns common to every provider:

- one-operation credential snapshots;
- missing-credential, HTTP, and response-data errors;
- parent cancellation plus configured timeout composition;
- bounded response reads and JSON decoding;
- common request headers and request ID capture.

`CredentialSnapshot` caches the promise for each reference inside one operation.
Concurrent sources therefore resolve a shared credential once. A new operation
creates a new snapshot.

### Provider adapters

Each external API has one focused adapter:

- `aisa.ts` owns the AIsa One Key transport and all AIsa endpoint shapes;
- `tavily.ts` owns direct web search and extraction;
- `x.ts` owns X API v2 recent search;
- `youtube.ts` owns YouTube Data API v3 search;
- `serpapi.ts` owns SerpApi Google Scholar search.

Adapters own fixed origins, authentication placement, methods, query strings,
and request bodies. Tool callers cannot supply an upstream origin or path.

### `providers/router.ts`

The router is both provider composition boundary and routing-policy authority.
It selects a provider before sending traffic:

~~~text
aisa    -> AIsa
byok    -> direct provider
hybrid  -> direct when its credential is configured, otherwise AIsa
~~~

Selection is credential-based, not outcome-based. Once selected, a provider
error is returned as that provider's error. Retrying through another provider
would duplicate side effects, obscure outages, and make billing unpredictable,
so runtime failover is deliberately absent.

### `normalize.ts`

This is the anti-corruption layer between current provider payloads and stable
Easy Search values. Normalizers retain citeable, provider-neutral fields and
discard raw provider-only metadata.

AIsa and direct APIs may expose different response shapes for the same source;
those differences end here. Downstream service and tool code never branches on
raw provider objects.

### `search.ts`

The application service validates tool-level options, applies public-URL rules,
starts one provider operation, dispatches selected sources concurrently, and
combines settled outcomes into results plus explicit coverage.

`Promise.allSettled` is intentional. A source outage is coverage information,
not a reason to erase healthy sibling results.

### `tools.ts`

The DSH adapter owns the two public schemas, compact model-facing rendering,
replay-safe presentation metadata, native web cards, concurrency declaration,
and System Prompt guidance.

The canonical return value is validated structured JSON. `render` and
`presentationMeta` are pure projections; neither has access to credentials or
raw provider responses.

### `index.ts`

The composition root installs the Easy Search Settings namespace, resolves the
current configuration at operation time, adapts DSH Credentials to a credential
resolver, creates the provider client and application service, and registers
the tools.

## Search flow

~~~text
model calls easy_search
  -> DSH validates arguments
  -> service validates domain options
  -> provider client snapshots configuration
  -> router selects one provider per source
  -> credentials resolve inside the operation snapshot
  -> selected provider requests run concurrently
  -> successful responses normalize to stable values
  -> service combines results and explicit coverage
  -> DSH validates canonical output
  -> render emits model-facing citations
  -> presentationMeta emits native web-card data
~~~

`easy_extract` follows the same boundaries but selects between AIsa and direct
Tavily for one validated set of one to three URLs.

## Invariants

- DSH owns settings and secret storage; the plugin stores references only.
- Public tools cannot supply provider origins, endpoint paths, or credentials.
- The AIsa base URL is a credential-free HTTP(S) origin.
- Direct provider origins are fixed by their adapters.
- A credential is resolved at most once per reference in one tool operation.
- Hybrid fallback occurs only for an absent direct credential.
- A selected provider error never triggers a hidden cross-provider retry.
- Raw provider payloads do not enter canonical output or presentation metadata.
- Upstream response bytes and retained text are independently bounded.
- Parent cancellation and configured timeouts reach every fetch.
- Every successful coverage entry identifies its actual provider.
- A failed selected source remains visible while healthy siblings are retained.
- Extract URLs cannot contain credentials or literal local/private addresses.
- DSH remains the authority for execution, permissions, replay, and UI.

## Extension rules

Adding another provider for an existing source should add one adapter and its
contract tests, then wire it into the provider set. It should not add provider
conditionals to `search.ts` or `tools.ts`.

Adding a new source should update the source union, normalized type, one or more
provider adapters, its normalizer, the router's source mapping, the public tool
schema, and contract tests.

A genuinely different capability belongs in a sibling directory under
`plugins` and owns its manifest, dependencies, tests, documentation, and release
lifecycle. Shared code should become a library only after two concrete plugins
need the same stable abstraction.

Compatibility branches for obsolete provider contracts are intentionally
avoided. Contract changes should be explicit, tested, and removed cleanly when
obsolete.

## Why there is no custom frontend

Search results already fit official DSH tool and web-presentation contracts. A
custom browser surface would duplicate session, permission, replay, and result
card behavior while coupling the plugin to one Harness build. Easy Search
therefore contributes native tool presentation and lets Harness own the user
experience. Configuration remains on official composition, Settings, and
Credentials seams even though the current Web client does not enumerate this
third-party settings namespace.
