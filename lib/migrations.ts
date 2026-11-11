export type Migration = { version: number; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      create table if not exists users (
        id text primary key,
        email text not null unique,
        name text not null,
        password_hash text not null,
        role text not null default 'viewer' check (role in ('admin','viewer')),
        created_at timestamptz not null default now()
      );

      create table if not exists sessions (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );
      create index if not exists sessions_user_idx on sessions(user_id);

      create table if not exists flags (
        id text primary key,
        key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,49}$'),
        name text not null,
        description text not null default '',
        enabled boolean not null default false,
        rollout_percentage integer not null default 0 check (rollout_percentage between 0 and 100),
        target_users jsonb not null default '[]'::jsonb,
        target_tenants jsonb not null default '[]'::jsonb,
        version integer not null default 1,
        updated_by text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists flags_key_idx on flags(key);

      create table if not exists benchmark_runs (
        id text primary key,
        rounds integer not null,
        p50_ms double precision not null,
        p95_ms double precision not null,
        cache_hits integer not null default 0,
        cache_misses integer not null default 0,
        created_at timestamptz not null default now()
      );

      create table if not exists audit_logs (
        id text primary key,
        user_id text references users(id) on delete set null,
        actor text not null,
        action text not null,
        detail jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists audit_created_idx on audit_logs(created_at desc);

      create table if not exists rate_limits (
        key text primary key,
        window_start bigint not null,
        count integer not null
      );

      create table if not exists request_logs (
        id text primary key,
        method text not null,
        path text not null,
        status integer not null,
        duration_ms integer not null,
        created_at timestamptz not null default now()
      );
      create index if not exists request_created_idx on request_logs(created_at desc);
    `,
  },
];
