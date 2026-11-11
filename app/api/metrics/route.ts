import { getUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { percentile } from '@/lib/flags';
import { fail, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BenchmarkRow = {
  rounds: number;
  p50_ms: number;
  p95_ms: number;
  cache_hits: number;
  cache_misses: number;
  created_at: string;
};

export const GET = route(async () => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để xem metrics.');
  const db = await getDb();

  const [flagRows, benchmarkRows, benchmarkCount, trafficRows, requestRows, auditRows] =
    await Promise.all([
      db.query<{ total: number; enabled: number; partial: number; targeted: number }>(
        `select count(*)::int as total,
                count(*) filter (where enabled)::int as enabled,
                count(*) filter (where rollout_percentage between 1 and 99)::int as partial,
                count(*) filter (where jsonb_array_length(target_users) + jsonb_array_length(target_tenants) > 0)::int as targeted
         from flags`,
      ),
      db.query<BenchmarkRow>(
        'select rounds, p50_ms, p95_ms, cache_hits, cache_misses, created_at from benchmark_runs order by created_at desc limit 1',
      ),
      db.query<{ count: number }>('select count(*)::int as count from benchmark_runs'),
      db.query<{ path: string; count: number }>(
        `select path, count(*)::int as count from request_logs
         where path in ('/api/evaluate', '/api/sdk/flags') group by path`,
      ),
      db.query<{ duration_ms: number }>('select duration_ms from request_logs order by created_at desc limit 300'),
      db.query<{ count: number }>('select count(*)::int as count from audit_logs'),
    ]);

  const latest = benchmarkRows.rows[0];
  const traffic = trafficRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.path] = Number(row.count);
    return acc;
  }, {});

  return Response.json({
    role: user.role,
    canManage: user.role === 'admin',
    flags: {
      total: Number(flagRows.rows[0]?.total ?? 0),
      enabled: Number(flagRows.rows[0]?.enabled ?? 0),
      partial: Number(flagRows.rows[0]?.partial ?? 0),
      targeted: Number(flagRows.rows[0]?.targeted ?? 0),
    },
    latestBenchmark: latest
      ? {
          rounds: Number(latest.rounds),
          p50Ms: Number(latest.p50_ms),
          p95Ms: Number(latest.p95_ms),
          cacheHits: Number(latest.cache_hits),
          cacheMisses: Number(latest.cache_misses),
          createdAt: latest.created_at,
          underBudget: Number(latest.p95_ms) < 50,
        }
      : null,
    benchmarkRuns: Number(benchmarkCount.rows[0]?.count ?? 0),
    traffic: {
      evaluations: traffic['/api/evaluate'] ?? 0,
      sdkFetches: traffic['/api/sdk/flags'] ?? 0,
    },
    auditEvents: Number(auditRows.rows[0]?.count ?? 0),
    requestLatencyMs: {
      p50: percentile(requestRows.rows.map((row) => Number(row.duration_ms)), 50),
      p95: percentile(requestRows.rows.map((row) => Number(row.duration_ms)), 95),
      samples: requestRows.rows.length,
    },
  });
});
