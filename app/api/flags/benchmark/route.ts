import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { audit, listFlags, percentile, type FlagRow } from '@/lib/flags';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';
import { createFlagClient } from '@/lib/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUDGET_MS = 50;

const schema = z.object({
  rounds: z.number().int().min(100).max(20_000).default(2_000),
});

export const POST = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để chạy benchmark.');
  if (user.role !== 'admin') return fail(403, 'forbidden', 'Chỉ admin được chạy benchmark.');

  const limit = await hitLimit(`benchmark:${user.id}`, 3, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Benchmark bị giới hạn 3 lần/phút.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const parsed = schema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return fail(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Số vòng không hợp lệ');
  }

  const db = await getDb();
  const scanStart = performance.now();
  const flags = await listFlags(db);
  const scanMs = Number((performance.now() - scanStart).toFixed(3));
  if (flags.length === 0) return fail(400, 'no_flags', 'Chưa có flag để benchmark.');

  const client = createFlagClient(async () => flags as FlagRow[], { ttlMs: 60_000 });
  const contexts = Array.from({ length: 20 }, (_, index) => ({
    userId: `bench-user-${index * 37}`,
    tenantId: `tenant-${index % 5}`,
  }));

  await client.all(contexts[0]);
  const durations: number[] = [];
  for (let round = 0; round < parsed.data.rounds; round += 1) {
    const context = contexts[round % contexts.length];
    const started = performance.now();
    await client.all(context);
    durations.push(performance.now() - started);
  }

  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  if (p50 === null || p95 === null) return fail(500, 'benchmark_failed', 'Không đo được latency.');

  const cache = client.stats();
  const id = randomUUID();
  await db.query(
    `insert into benchmark_runs (id, rounds, p50_ms, p95_ms, cache_hits, cache_misses)
     values ($1,$2,$3,$4,$5,$6)`,
    [id, parsed.data.rounds, p50, p95, cache.hits, cache.misses],
  );
  await audit(db, user.id, user.email, 'benchmark_ran', {
    rounds: parsed.data.rounds,
    p95Ms: p95,
    underBudget: p95 < BUDGET_MS,
  });
  await saveState();

  return Response.json({
    run: {
      id,
      rounds: parsed.data.rounds,
      flags: flags.length,
      evaluations: parsed.data.rounds * flags.length,
      p50Ms: p50,
      p95Ms: p95,
      budgetMs: BUDGET_MS,
      underBudget: p95 < BUDGET_MS,
      scanMs,
      cache,
      createdAt: new Date().toISOString(),
    },
  });
});
