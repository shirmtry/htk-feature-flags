import { evaluateAll, evaluateFlag, type EvalContext, type Evaluation, type FlagRow } from './flags';

export type FlagSnapshot = {
  flags: FlagRow[];
  fetchedAt: number;
  source: 'loader' | 'cache' | 'stale';
};

export type ClientStats = {
  hits: number;
  misses: number;
  loads: number;
  errors: number;
  lastLoadedAt: number | null;
  cached: boolean;
};

export type FlagClient = {
  all(context: EvalContext): Promise<Evaluation[]>;
  get(key: string, context: EvalContext): Promise<Evaluation | null>;
  snapshot(force?: boolean): Promise<FlagSnapshot>;
  invalidate(): void;
  stats(): ClientStats;
};

type Clock = () => number;

export function createFlagClient(
  loader: () => Promise<FlagRow[]>,
  options: { ttlMs?: number; now?: Clock } = {},
): FlagClient {
  const ttlMs = options.ttlMs ?? 30_000;
  const now: Clock = options.now ?? (() => Date.now());
  let cache: FlagSnapshot | null = null;
  let inflight: Promise<FlagSnapshot> | null = null;
  const counters = { hits: 0, misses: 0, loads: 0, errors: 0 };

  async function snapshot(force = false): Promise<FlagSnapshot> {
    if (!force && cache && now() - cache.fetchedAt < ttlMs) {
      counters.hits += 1;
      return { ...cache, source: 'cache' };
    }
    if (inflight) return inflight;
    counters.misses += 1;
    inflight = (async () => {
      try {
        const flags = await loader();
        counters.loads += 1;
        cache = { flags, fetchedAt: now(), source: 'loader' };
        return cache;
      } catch (error) {
        counters.errors += 1;
        if (cache) return { ...cache, source: 'stale' };
        throw error;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    async get(key, context) {
      const result = await snapshot();
      const flag = result.flags.find((item) => item.key === key);
      return flag ? evaluateFlag(flag, context) : null;
    },
    async all(context) {
      const result = await snapshot();
      return evaluateAll(result.flags, context);
    },
    snapshot,
    invalidate() {
      cache = null;
    },
    stats() {
      return {
        ...counters,
        lastLoadedAt: cache?.fetchedAt ?? null,
        cached: Boolean(cache),
      };
    },
  };
}
