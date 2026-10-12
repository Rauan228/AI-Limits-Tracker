import { ProviderType, RECIPE_PROVIDERS } from '../../models/types';
import { PROVIDER_NAMES } from '../../constants/theme';
import { ChatGPTProvider } from './ChatGPTProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { GeminiProvider } from './GeminiProvider';
import { RecipeProvider } from './recipe';
import { UsageProvider } from './UsageProvider';

const PROVIDERS: Partial<Record<ProviderType, UsageProvider>> = {
  claude: new ClaudeProvider(),
  chatgpt: new ChatGPTProvider(),
  gemini: new GeminiProvider(),
  custom: new RecipeProvider('custom', 'Custom'),
};

// Register every recipe-driven service (Cursor, Copilot, Perplexity, …)
for (const type of RECIPE_PROVIDERS) {
  PROVIDERS[type] = new RecipeProvider(type, PROVIDER_NAMES[type] || type);
}

export function getProvider(type: ProviderType): UsageProvider {
  return PROVIDERS[type] || PROVIDERS.custom!;
}

export * from './ChatGPTProvider';
export * from './ClaudeProvider';
export * from './GeminiProvider';
export * from './recipe';
export * from './UsageProvider';
