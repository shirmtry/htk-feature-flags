import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';

export type FlagRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rollout_percentage: number;
  target_users: string[];
  target_tenants: string[];
  version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EvalContext = { userId?: string; tenantId?: string };
export type EvaluationReason = 'disabled' | 'user_target' | 'tenant_target' | 'rollout' | 'default';

export type Evaluation = {
  key: string;
  value: boolean;
  reason: EvaluationReason;
  bucket: number | null;
  version: number;
};

export type FlagInput = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetUsers: string[];
  targetTenants: string[];
};

export function bucketFor(key: string, identity: string): number {
  // FNV-1a over the flag key + identity keeps a user's bucket stable across deploys
  // and across flags with independent rollouts.
  const input = `${key}:${identity}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function evaluateFlag(flag: FlagRow, context: EvalContext): Evaluation {
  if (!flag.enabled) {
    return { key: flag.key, value: false, reason: 'disabled', bucket: null, version: flag.version };
  }
  if (context.userId && flag.target_users.includes(context.userId)) {
    return { key: flag.key, value: true, reason: 'user_target', bucket: null, version: flag.version };
  }
  if (context.tenantId && flag.target_tenants.includes(context.tenantId)) {
    return { key: flag.key, value: true, reason: 'tenant_target', bucket: null, version: flag.version };
  }
  const identity = context.userId ?? context.tenantId;
  if (flag.rollout_percentage > 0 && identity) {
    const bucket = bucketFor(flag.key, identity);
    return {
      key: flag.key,
      value: bucket < flag.rollout_percentage,
      reason: 'rollout',
      bucket,
      version: flag.version,
    };
  }
  return { key: flag.key, value: false, reason: 'default', bucket: null, version: flag.version };
}

export function evaluateAll(flags: FlagRow[], context: EvalContext): Evaluation[] {
  return flags.map((flag) => evaluateFlag(flag, context));
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(4));
}

function normalize(flag: FlagRow): FlagRow {
  return {
    ...flag,
    rollout_percentage: Number(flag.rollout_percentage),
    version: Number(flag.version),
    target_users: Array.isArray(flag.target_users) ? flag.target_users : [],
    target_tenants: Array.isArray(flag.target_tenants) ? flag.target_tenants : [],
  };
}

export async function listFlags(db: PGlite): Promise<FlagRow[]> {
  const result = await db.query<FlagRow>('select * from flags order by created_at asc, key asc');
  return result.rows.map(normalize);
}

export async function findFlag(db: PGlite, id: string): Promise<FlagRow | null> {
  const result = await db.query<FlagRow>('select * from flags where id = $1', [id]);
  const row = result.rows[0];
  return row ? normalize(row) : null;
}

export async function audit(
  db: PGlite,
  actorId: string | null,
  actor: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.query(
    'insert into audit_logs (id, user_id, actor, action, detail) values ($1,$2,$3,$4,$5::jsonb)',
    [randomUUID(), actorId, actor, action, JSON.stringify(detail)],
  );
}

export async function createFlag(
  db: PGlite,
  input: FlagInput,
  actor: { id: string; email: string },
): Promise<FlagRow> {
  const id = randomUUID();
  const result = await db.query<FlagRow>(
    `insert into flags
      (id, key, name, description, enabled, rollout_percentage, target_users, target_tenants, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
     returning *`,
    [
      id,
      input.key,
      input.name,
      input.description,
      input.enabled,
      input.rolloutPercentage,
      JSON.stringify(input.targetUsers),
      JSON.stringify(input.targetTenants),
      actor.email,
    ],
  );
  await audit(db, actor.id, actor.email, 'flag_created', {
    key: input.key,
    enabled: input.enabled,
    rollout: input.rolloutPercentage,
  });
  return normalize(result.rows[0]);
}

export type UpdateResult =
  | { ok: true; flag: FlagRow }
  | { ok: false; reason: 'not_found' | 'conflict'; current: FlagRow | null };

export async function updateFlag(
  db: PGlite,
  id: string,
  input: FlagInput,
  expectedVersion: number,
  actor: { id: string; email: string },
): Promise<UpdateResult> {
  const before = await findFlag(db, id);
  if (!before) return { ok: false, reason: 'not_found', current: null };

  const result = await db.query<FlagRow>(
    `update flags set
       key = $2, name = $3, description = $4, enabled = $5, rollout_percentage = $6,
       target_users = $7::jsonb, target_tenants = $8::jsonb, updated_by = $9,
       version = version + 1, updated_at = now()
     where id = $1 and version = $10
     returning *`,
    [
      id,
      input.key,
      input.name,
      input.description,
      input.enabled,
      input.rolloutPercentage,
      JSON.stringify(input.targetUsers),
      JSON.stringify(input.targetTenants),
      actor.email,
      expectedVersion,
    ],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, reason: 'conflict', current: await findFlag(db, id) };

  const flag = normalize(row);
  await audit(db, actor.id, actor.email, 'flag_updated', {
    key: flag.key,
    fromVersion: before.version,
    toVersion: flag.version,
    changes: {
      enabled: [before.enabled, flag.enabled],
      rollout: [before.rollout_percentage, flag.rollout_percentage],
      users: [before.target_users.length, flag.target_users.length],
      tenants: [before.target_tenants.length, flag.target_tenants.length],
    },
  });
  return { ok: true, flag };
}

export async function deleteFlag(
  db: PGlite,
  id: string,
  actor: { id: string; email: string },
): Promise<FlagRow | null> {
  const before = await findFlag(db, id);
  if (!before) return null;
  await db.query('delete from flags where id = $1', [id]);
  await audit(db, actor.id, actor.email, 'flag_deleted', {
    key: before.key,
    version: before.version,
  });
  return before;
}
