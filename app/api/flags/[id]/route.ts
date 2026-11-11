import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { deleteFlag, updateFlag } from '@/lib/flags';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.array(z.string().trim().min(1).max(64)).max(50);

const patchSchema = z.object({
  version: z.number().int().positive(),
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,49}$/, 'Key chỉ gồm a-z, 0-9 và dấu gạch ngang (2-50 ký tự)'),
  name: z.string().trim().min(2, 'Tên cần ít nhất 2 ký tự').max(80),
  description: z.string().trim().max(280).default(''),
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
  targetUsers: listSchema.default([]),
  targetTenants: listSchema.default([]),
});

function idFrom(req: Request): string {
  return new URL(req.url).pathname.split('/').pop() ?? '';
}

function uniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

export const PATCH = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để sửa flag.');
  if (user.role !== 'admin') return fail(403, 'forbidden', 'Chỉ admin được sửa flag.');

  const limit = await hitLimit(`flag-patch:${user.id}`, 60, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Quá nhiều thao tác cập nhật. Thử lại sau.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
  }

  const id = idFrom(req);
  const db = await getDb();
  const duplicate = await db.query('select id from flags where key = $1 and id <> $2', [
    parsed.data.key,
    id,
  ]);
  if (duplicate.rows.length) return fail(409, 'key_taken', 'Key này đã tồn tại.');

  try {
    const result = await updateFlag(db, id, parsed.data, parsed.data.version, user);
    if (!result.ok) {
      if (result.reason === 'not_found') return fail(404, 'not_found', 'Không tìm thấy flag.');
      return fail(409, 'version_conflict', 'Flag đã được người khác sửa. Tải lại rồi thử lại.', {
        'X-Current-Version': String(result.current?.version ?? ''),
      });
    }
    await saveState();
    return Response.json({ flag: result.flag });
  } catch (error) {
    if (uniqueViolation(error)) return fail(409, 'key_taken', 'Key này đã tồn tại.');
    throw error;
  }
});

export const DELETE = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để xoá flag.');
  if (user.role !== 'admin') return fail(403, 'forbidden', 'Chỉ admin được xoá flag.');

  const limit = await hitLimit(`flag-delete:${user.id}`, 20, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Quá nhiều thao tác xoá. Thử lại sau.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const db = await getDb();
  const deleted = await deleteFlag(db, idFrom(req), user);
  if (!deleted) return fail(404, 'not_found', 'Không tìm thấy flag.');
  await saveState();
  return Response.json({ deleted: deleted.key });
});
