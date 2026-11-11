import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  bucketFor,
  createFlag,
  deleteFlag,
  evaluateAll,
  evaluateFlag,
  listFlags,
  updateFlag,
  type FlagInput,
  type FlagRow,
} from './flags';
import { createFlagClient } from './sdk';
import { MIGRATIONS } from './migrations';

let db: PGlite;
let actor: { id: string; email: string };

const baseInput: FlagInput = {
  key: 'test-flag',
  name: 'Test flag',
  description: 'Dùng cho unit test',
  enabled: true,
  rolloutPercentage: 0,
  targetUsers: [],
  targetTenants: [],
};

beforeEach(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(MIGRATIONS[0].sql);
  actor = { id: randomUUID(), email: 'admin@test.dev' };
  await db.query(
    'insert into users (id, email, name, password_hash, role) values ($1,$2,$3,$4,$5)',
    [actor.id, actor.email, 'Admin', 'scrypt$x$y', 'admin'],
  );
});

afterEach(async () => {
  await db.close();
});

function flag(overrides: Partial<FlagRow> = {}): FlagRow {
  return {
    id: randomUUID(),
    key: 'new-checkout',
    name: 'Checkout',
    description: '',
    enabled: true,
    rollout_percentage: 0,
    target_users: [],
    target_tenants: [],
    version: 1,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('bucketing', () => {
  it('is deterministic and stays in 0..99', () => {
    const first = bucketFor('new-checkout', 'user-1');
    expect(bucketFor('new-checkout', 'user-1')).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);
    expect(bucketFor('new-checkout', 'user-2')).not.toBe(first);
  });

  it('spreads identities across the whole range', () => {
    const buckets = new Set<number>();
    for (let index = 0; index < 500; index += 1) {
      buckets.add(bucketFor('beta-reports', `user-${index}`));
    }
    expect(buckets.size).toBeGreaterThan(90);
  });
});

describe('evaluation priority', () => {
  it('disabled wins over every target', () => {
    const result = evaluateFlag(flag({ enabled: false, target_users: ['u1'] }), { userId: 'u1' });
    expect(result.value).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('targets a user before rollout', () => {
    const result = evaluateFlag(
      flag({ rollout_percentage: 0, target_users: ['u1'], target_tenants: ['acme'] }),
      { userId: 'u1', tenantId: 'acme' },
    );
    expect(result).toMatchObject({ value: true, reason: 'user_target', bucket: null });
  });

  it('targets a tenant when the user is not listed', () => {
    const result = evaluateFlag(flag({ target_tenants: ['globex'] }), {
      userId: 'someone',
      tenantId: 'globex',
    });
    expect(result).toMatchObject({ value: true, reason: 'tenant_target' });
  });

  it('uses the stable bucket for percentage rollout', () => {
    const subject = flag({ rollout_percentage: 35 });
    const bucket = bucketFor(subject.key, 'user-77');
    const result = evaluateFlag(subject, { userId: 'user-77' });
    expect(result.reason).toBe('rollout');
    expect(result.bucket).toBe(bucket);
    expect(result.value).toBe(bucket < 35);
  });

  it('defaults to false without an identity even at 100%', () => {
    expect(evaluateFlag(flag({ rollout_percentage: 100 }), {}).value).toBe(false);
    expect(evaluateFlag(flag({ rollout_percentage: 100 }), { userId: 'u' }).value).toBe(true);
    expect(evaluateFlag(flag({ rollout_percentage: 0 }), { userId: 'u' })).toMatchObject({
      value: false,
      reason: 'default',
    });
  });

  it('evaluates every flag with the same context', () => {
    const results = evaluateAll(
      [flag({ key: 'a', enabled: false }), flag({ key: 'b', target_users: ['u'] })],
      { userId: 'u' },
    );
    expect(results.map((item) => [item.key, item.value])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });
});

describe('flag administration', () => {
  it('creates, updates with optimistic versioning and audits both writes', async () => {
    const created = await createFlag(db, baseInput, actor);
    expect(created.version).toBe(1);
    expect(await listFlags(db)).toHaveLength(1);

    const updated = await updateFlag(
      db,
      created.id,
      { ...baseInput, rolloutPercentage: 25 },
      1,
      actor,
    );
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.flag.version).toBe(2);

    const conflict = await updateFlag(db, created.id, baseInput, 1, actor);
    expect(conflict).toMatchObject({ ok: false, reason: 'conflict' });
    if (!conflict.ok) expect(conflict.current?.version).toBe(2);

    const logs = await db.query<{ action: string }>('select action from audit_logs order by created_at');
    expect(logs.rows.map((row) => row.action)).toEqual(['flag_created', 'flag_updated']);

    await deleteFlag(db, created.id, actor);
    expect(await listFlags(db)).toHaveLength(0);
  });

  it('returns not_found for unknown ids', async () => {
    const result = await updateFlag(db, randomUUID(), baseInput, 1, actor);
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('SDK client cache', () => {
  const snapshot = [
    flag({ key: 'a', target_users: ['u1'] }),
    flag({ key: 'b', rollout_percentage: 0 }),
  ];

  it('serves repeated reads from cache until TTL expires', async () => {
    let clock = 1_000;
    let loads = 0;
    const client = createFlagClient(
      async () => {
        loads += 1;
        return snapshot;
      },
      { ttlMs: 500, now: () => clock },
    );

    expect((await client.get('a', { userId: 'u1' }))?.value).toBe(true);
    await client.get('b', { userId: 'u1' });
    await client.all({ userId: 'u1' });
    expect(loads).toBe(1);
    expect(client.stats()).toMatchObject({ hits: 2, misses: 1, loads: 1, cached: true });

    clock += 600;
    await client.get('a', { userId: 'u1' });
    expect(loads).toBe(2);
    expect(client.stats()).toMatchObject({ misses: 2, loads: 2 });
  });

  it('deduplicates concurrent cold loads', async () => {
    let resolveLoader: (flags: FlagRow[]) => void = () => undefined;
    let loads = 0;
    const client = createFlagClient(() => {
      loads += 1;
      return new Promise<FlagRow[]>((resolve) => {
        resolveLoader = resolve;
      });
    });

    const first = client.all({ userId: 'u1' });
    const second = client.all({ userId: 'u1' });
    resolveLoader(snapshot);
    await Promise.all([first, second]);
    expect(loads).toBe(1);
  });

  it('falls back to stale data when a TTL refresh fails', async () => {
    let clock = 1;
    let fail = false;
    const client = createFlagClient(
      async () => {
        if (fail) throw new Error('network down');
        return snapshot;
      },
      { ttlMs: 10, now: () => clock },
    );

    await client.all({ userId: 'u1' });
    clock += 20;
    fail = true;
    const stale = await client.snapshot();
    expect(stale.source).toBe('stale');
    expect(stale.flags).toHaveLength(2);
    expect(client.stats().errors).toBe(1);

    fail = false;
    clock += 20;
    expect((await client.snapshot()).source).toBe('loader');
  });

  it('invalidates the cache and reloads on the next read', async () => {
    let loads = 0;
    const client = createFlagClient(async () => {
      loads += 1;
      return snapshot;
    });

    await client.all({ userId: 'u1' });
    client.invalidate();
    expect(client.stats().cached).toBe(false);
    await client.all({ userId: 'u1' });
    expect(loads).toBe(2);
  });
});
