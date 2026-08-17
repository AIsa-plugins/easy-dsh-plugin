import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  installSettingsSection,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import {
  Config as ConfigSchema,
  resolveConfig,
  type Config as PluginConfig,
} from './config.ts'
import { AisaClient } from './client.ts'
import { EasySearchService } from './search.ts'
import { registerEasySearchTools } from './tools.ts'

export { ConfigSchema as Config }
export type { Config as EasySearchConfig, ResolvedConfig } from './config.ts'
export * from './types.ts'
export {
  EasySearchService,
  parseExtractOptions,
  parseSearchOptions,
  publicUrl,
} from './search.ts'

export const name = 'easy-search'
export const inject = ['credentials', 'tools', 'systemPrompt']
export const EASY_SEARCH_SETTINGS_NAMESPACE = settingsNamespace('easy-search')

export function apply(ctx: Context, config: PluginConfig = {}): void {
  resolveConfig(config)

  let current: () => PluginConfig = () => config
  installSettingsSection(ctx, EASY_SEARCH_SETTINGS_NAMESPACE, ConfigSchema, config, {
    setSource: source => {
      current = source
    },
    onChange: () => {},
    validate: value => {
      resolveConfig(value)
    },
  })

  const resolved = () => resolveConfig(current())
  const client = new AisaClient({
    config: resolved,
    resolveApiKey: async (reference) =>
      (await ctx.credentials.resolve(credentialRef(reference)))?.value,
  })
  registerEasySearchTools(ctx, new EasySearchService(client, resolved))
}
