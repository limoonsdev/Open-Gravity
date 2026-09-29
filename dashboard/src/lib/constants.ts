import type { Strategy } from './types';

export const STRATEGIES: Record<Strategy, { label: string; help: string }> = {
  fallback: { label: 'Fallback in order', help: 'Always try the first target, move to the next one on errors or rate limits.' },
  'round-robin': { label: 'Round-robin', help: 'Rotate the first target on every request to spread the load, fall back on errors.' },
  random: { label: 'Random', help: 'Shuffle the order on every request, fall back on errors.' },
  fastest: { label: 'Fastest first', help: 'Order by measured time to first token (targets never measured are tried first).' },
  cheapest: { label: 'Cheapest first', help: 'Order by list price from the model database; local models count as free.' },
  race: { label: 'Race', help: 'Query the first two targets at once and keep the first to answer (faster, uses more tokens).' },
};
