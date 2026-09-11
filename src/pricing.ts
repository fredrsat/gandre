// Prisestimat per modell, USD per million tokens (inn/ut).
// Kilder: Anthropic-prisliste (hentet 2026-09-11). Ollama er lokal og gratis;
// OpenRouter-modeller varierer for mye til å anslå — ukjente modeller gir null.
import type { Provider } from './types.js';

const USD_PER_MTOK: { prefix: string; input: number; output: number }[] = [
  { prefix: 'claude-opus-5', input: 5, output: 25 },
  { prefix: 'claude-opus-4', input: 5, output: 25 },
  { prefix: 'claude-sonnet-5', input: 3, output: 15 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15 },
  { prefix: 'claude-haiku-4-5', input: 1, output: 5 },
];

// null = ukjent pris (vis tokens uten kostnad)
export function estimateCostUsd(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  if (provider === 'ollama') return 0;
  const entry = USD_PER_MTOK.find((e) => model.startsWith(e.prefix));
  if (!entry) return null;
  return (inputTokens * entry.input + outputTokens * entry.output) / 1_000_000;
}

export function formatCostUsd(cost: number | null): string {
  if (cost === null) return '–';
  if (cost === 0) return 'gratis';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}
