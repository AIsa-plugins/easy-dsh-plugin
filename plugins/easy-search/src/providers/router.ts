import type { ResolvedConfig } from '../config.ts'
import type {
  EasyExtractInput,
  EasyExtractResult,
  EasySearchInput,
  SearchSource,
  SourceSearchResult,
} from '../types.ts'
import { createAisaProviderSet } from './aisa.ts'
import type {
  ExtractProvider,
  ProviderOperation,
  ProviderRoutes,
  ProviderSet,
  SourceProvider,
} from './contracts.ts'
import { CredentialSnapshot, JsonHttpClient, type CredentialResolver } from './runtime.ts'
import { createSerpApiScholarProvider } from './serpapi.ts'
import { createTavilyProviders } from './tavily.ts'
import { createXProvider } from './x.ts'
import { createYouTubeProvider } from './youtube.ts'

interface Routable {
  configured(): Promise<boolean>
}

async function selected<T extends Routable>(
  mode: ProviderRoutes['mode'],
  direct: T,
  aisa: T,
): Promise<T> {
  if (mode === 'aisa') return aisa
  if (mode === 'byok') return direct
  return await direct.configured() ? direct : aisa
}

function sourceProvider(providers: ProviderSet, source: SearchSource): SourceProvider {
  switch (source) {
    case 'web': return providers.web
    case 'x': return providers.x
    case 'youtube': return providers.youtube
    case 'scholar': return providers.scholar
  }
}

class RoutedOperation implements ProviderOperation {
  constructor(private readonly routes: ProviderRoutes) {}

  async search(
    source: SearchSource,
    input: EasySearchInput,
    signal: AbortSignal,
  ): Promise<SourceSearchResult> {
    const direct = sourceProvider(this.routes.direct, source)
    const aisa = sourceProvider(this.routes.aisa, source)
    return await (await selected(this.routes.mode, direct, aisa)).search(input, signal)
  }

  async extract(
    input: EasyExtractInput,
    signal: AbortSignal,
  ): Promise<EasyExtractResult> {
    const provider = await selected(
      this.routes.mode,
      this.routes.direct.extract,
      this.routes.aisa.extract,
    )
    return await provider.extract(input, signal)
  }
}

export interface EasySearchProviderClientOptions {
  readonly config: () => ResolvedConfig
  readonly resolveCredential: CredentialResolver
  readonly fetchImpl?: typeof fetch
}

export class EasySearchProviderClient {
  constructor(private readonly options: EasySearchProviderClientOptions) {}

  start(): ProviderOperation {
    const config = this.options.config()
    const credentials = new CredentialSnapshot(this.options.resolveCredential)
    const http = new JsonHttpClient(config, this.options.fetchImpl ?? globalThis.fetch)
    const aisa = createAisaProviderSet(config, credentials, http)
    const tavily = createTavilyProviders(config, credentials, http)
    const direct: ProviderSet = {
      web: tavily.web,
      x: createXProvider(config, credentials, http),
      youtube: createYouTubeProvider(config, credentials, http),
      scholar: createSerpApiScholarProvider(config, credentials, http),
      extract: tavily.extract,
    }
    return new RoutedOperation({
      mode: config.routingMode,
      aisa,
      direct,
    })
  }
}
