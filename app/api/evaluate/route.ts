import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { evaluateAll, evaluateFlag, listFlags } from '@/lib/flags';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,49}$/)
    .optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  tenantId: z.string().trim().min(1).max(64).optional(),
});

export const POST = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để evaluate.');

  const limit = await hitLimit(`evaluate:${user.id}`, 600, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Quá nhiều lần evaluate. Thử lại sau.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
  }

  const context = { userId: parsed.data.userId, tenantId: parsed.data.tenantId };
  const db = await getDb();
  const flags = await listFlags(db);
  const evaluatedAt = new Date().toISOString();

  if (parsed.data.key) {
    const flag = flags.find((item) => item.key === parsed.data.key);
    if (!flag) return fail(404, 'not_found', 'Không tìm thấy flag.');
    return Response.json({
      context,
      evaluations: [evaluateFlag(flag, context)],
      count: 1,
      evaluatedAt,
    });
  }

  const evaluations = evaluateAll(flags, context);
  return Response.json({ context, evaluations, count: evaluations.length, evaluatedAt });
});
