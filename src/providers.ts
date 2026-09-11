import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import { config } from './config.js';
import type { Provider } from './types.js';

export interface ProviderOverrides {
  apiKey?: string | null;  // per-agent nøkkel; fallback til .env
  baseUrl?: string | null; // per-agent endepunkt (kun ollama); fallback til .env
}

export function resolveModel(provider: Provider, model: string, overrides: ProviderOverrides = {}): LanguageModel {
  switch (provider) {
    case 'anthropic': {
      const apiKey = overrides.apiKey || config.anthropicApiKey;
      if (!apiKey) throw new Error('Ingen API-nøkkel: sett den på agenten eller ANTHROPIC_API_KEY i .env');
      return createAnthropic({ apiKey })(model);
    }
    case 'openrouter': {
      const apiKey = overrides.apiKey || config.openrouterApiKey;
      if (!apiKey) throw new Error('Ingen API-nøkkel: sett den på agenten eller OPENROUTER_API_KEY i .env');
      return createOpenRouter({ apiKey }).chat(model);
    }
    case 'ollama':
      return createOllama({ baseURL: overrides.baseUrl || config.ollamaBaseUrl })(model);
    default:
      throw new Error(`Ukjent provider: ${provider}`);
  }
}

export const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openrouter: ['anthropic/claude-sonnet-5', 'openai/gpt-5.2', 'google/gemini-3-pro'],
  ollama: ['qwen3:14b', 'llama3.1:8b', 'gpt-oss:20b'],
};
