import { ProviderType } from '../../models/types';
import { ChatGPTProvider } from './ChatGPTProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { GeminiProvider } from './GeminiProvider';
import { UsageProvider } from './UsageProvider';

const claudeProvider = new ClaudeProvider();
const chatgptProvider = new ChatGPTProvider();
const geminiProvider = new GeminiProvider();

const PROVIDERS: Record<ProviderType, UsageProvider> = {
  claude: claudeProvider,
  chatgpt: chatgptProvider,
  gemini: geminiProvider,
  custom: claudeProvider, // fallback/custom
};

export function getProvider(type: ProviderType): UsageProvider {
  return PROVIDERS[type] || claudeProvider;
}

export * from './ChatGPTProvider';
export * from './ClaudeProvider';
export * from './GeminiProvider';
export * from './UsageProvider';
