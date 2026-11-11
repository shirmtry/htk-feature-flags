import { getUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listFlags } from '@/lib/flags';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'SDK cần session hợp lệ.');

  const limit = await hitLimit(`sdk:${user.id}`, 300, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'SDK fetch quá nhanh. Thử lại sau.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const db = await getDb();
  const flags = await listFlags(db);
  const maxVersion = flags.reduce((max, flag) => Math.max(max, flag.version), 0);
  const etag = `"ff-${flags.length}-${maxVersion}"`;
  const headers = {
    ETag: etag,
    'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
  };

  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  return Response.json(
    { flags, etag, generatedAt: new Date().toISOString() },
    { headers },
  );
});
