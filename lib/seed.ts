import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { hashPassword } from './password';

export const DEMO_EMAIL = 'demo@htk.dev';
export const DEMO_PASSWORD = 'Demo12345!';
export const VIEWER_EMAIL = 'viewer@htk.dev';

type SeedFlag = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rollout: number;
  users: string[];
  tenants: string[];
};

// Demo flags cover every evaluation branch: off, full rollout, percentage, user and tenant targeting.
const SEED_FLAGS: SeedFlag[] = [
  {
    key: 'new-checkout',
    name: 'Checkout mới',
    description: 'Luồng thanh toán một bước, bật cho 35% người dùng và nhóm nội bộ.',
    enabled: true,
    rollout: 35,
    users: ['user-demo'],
    tenants: [],
  },
  {
    key: 'dark-mode',
    name: 'Dark mode',
    description: 'Giao diện tối đã hoàn thiện, bật toàn bộ người dùng.',
    enabled: true,
    rollout: 100,
    users: [],
    tenants: [],
  },
  {
    key: 'beta-reports',
    name: 'Báo cáo beta',
    description: 'Báo cáo tuỳ biến, thử nghiệm với 10% người dùng và vài tài khoản chỉ định.',
    enabled: true,
    rollout: 10,
    users: ['user-42'],
    tenants: ['acme'],
  },
  {
    key: 'maintenance-banner',
    name: 'Banner bảo trì',
    description: 'Bật thủ công trong cửa sổ bảo trì; mặc định tắt.',
    enabled: false,
    rollout: 100,
    users: [],
    tenants: [],
  },
  {
    key: 'ai-summary',
    name: 'AI summary',
    description: 'Tóm tắt bằng AI, bật cho 50% người dùng và tenant globex.',
    enabled: true,
    rollout: 50,
    users: [],
    tenants: ['globex'],
  },
];

export async function seedDemo(db: PGlite) {
  const existing = await db.query<{ count: number }>('select count(*)::int as count from users');
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  const password = await hashPassword(DEMO_PASSWORD);
  const adminId = randomUUID();
  const viewerId = randomUUID();

  await db.query(
    'insert into users (id, email, name, password_hash, role) values ($1,$2,$3,$4,$5), ($6,$7,$8,$4,$9)',
    [
      adminId,
      DEMO_EMAIL,
      'Flag Admin',
      password,
      'admin',
      viewerId,
      VIEWER_EMAIL,
      'Flag Viewer',
      'viewer',
    ],
  );

  for (const flag of SEED_FLAGS) {
    await db.query(
      `insert into flags
        (id, key, name, description, enabled, rollout_percentage, target_users, target_tenants, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [
        randomUUID(),
        flag.key,
        flag.name,
        flag.description,
        flag.enabled,
        flag.rollout,
        JSON.stringify(flag.users),
        JSON.stringify(flag.tenants),
        'seed',
      ],
    );
  }

  await db.query(
    `insert into audit_logs (id, user_id, actor, action, detail)
     values ($1,$2,'seed','demo_seeded','{"flags":5}'::jsonb)`,
    [randomUUID(), adminId],
  );
}
