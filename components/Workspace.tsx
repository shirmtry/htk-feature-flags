'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type SessionUser = { id: string; email: string; name: string; role: 'admin' | 'viewer' };

type Flag = {
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

type Benchmark = {
  rounds: number;
  p50Ms: number;
  p95Ms: number;
  cacheHits: number;
  cacheMisses: number;
  createdAt: string;
  underBudget: boolean;
};

type Metrics = {
  role: 'admin' | 'viewer';
  canManage: boolean;
  flags: { total: number; enabled: number; partial: number; targeted: number };
  latestBenchmark: Benchmark | null;
  benchmarkRuns: number;
  traffic: { evaluations: number; sdkFetches: number };
  auditEvents: number;
  requestLatencyMs: { p50: number | null; p95: number | null; samples: number };
};

type AuditLog = {
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

type Evaluation = {
  key: string;
  value: boolean;
  reason: 'disabled' | 'user_target' | 'tenant_target' | 'rollout' | 'default';
  bucket: number | null;
  version: number;
};

type BenchmarkRun = {
  id: string;
  rounds: number;
  flags: number;
  evaluations: number;
  p50Ms: number;
  p95Ms: number;
  budgetMs: number;
  underBudget: boolean;
  scanMs: number;
  cache: { hits: number; misses: number; loads: number; errors: number; cached: boolean };
  createdAt: string;
};

type FormState = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetUsers: string;
  targetTenants: string;
};

const REASON_LABEL: Record<Evaluation['reason'], string> = {
  disabled: 'flag đang tắt',
  user_target: 'target user',
  tenant_target: 'target tenant',
  rollout: 'rollout %',
  default: 'mặc định',
};

const emptyForm = (): FormState => ({
  key: '',
  name: '',
  description: '',
  enabled: true,
  rolloutPercentage: 0,
  targetUsers: '',
  targetTenants: '',
});

const toForm = (flag: Flag): FormState => ({
  key: flag.key,
  name: flag.name,
  description: flag.description,
  enabled: flag.enabled,
  rolloutPercentage: flag.rollout_percentage,
  targetUsers: flag.target_users.join(', '),
  targetTenants: flag.target_tenants.join(', '),
});

const parseList = (value: string) =>
  Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));

function errorMessage(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error?: { message?: string } }).error;
    if (error && typeof error.message === 'string') return error.message;
  }
  return null;
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(data) ?? `Yêu cầu thất bại (${response.status}).`);
  }
  return data as T;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function formatMs(value: number | null): string {
  if (value === null) return 'chưa đo';
  return `${value.toFixed(2)} ms`;
}

function hitRate(benchmark: Benchmark | null): string {
  if (!benchmark) return 'chưa đo';
  const total = benchmark.cacheHits + benchmark.cacheMisses;
  if (total === 0) return '—';
  return `${((benchmark.cacheHits / total) * 100).toFixed(1)}%`;
}

export function Workspace({ user }: { user: SessionUser }) {
  const router = useRouter();
  const isAdmin = user.role === 'admin';

  const [flags, setFlags] = useState<Flag[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [audit, setAudit] = useState<AuditLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Flag | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [evalUserId, setEvalUserId] = useState('user-demo');
  const [evalTenantId, setEvalTenantId] = useState('acme');
  const [evaluations, setEvaluations] = useState<Evaluation[] | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkRun | null>(null);

  const fetchAll = useCallback(
    async (initial: boolean) => {
      if (initial) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const [flagsResponse, metricsResponse, auditResponse] = await Promise.all([
          fetch('/api/flags', { cache: 'no-store' }),
          fetch('/api/metrics', { cache: 'no-store' }),
          isAdmin ? fetch('/api/audit', { cache: 'no-store' }) : Promise.resolve(null),
        ]);
        const flagsData = await readJson<{ flags: Flag[] }>(flagsResponse);
        const metricsData = await readJson<Metrics>(metricsResponse);
        const auditData = auditResponse
          ? (await readJson<{ logs: AuditLog[] }>(auditResponse)).logs
          : null;
        setFlags(flagsData.flags);
        setMetrics(metricsData);
        setAudit(auditData);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Không tải được dữ liệu.';
        if (initial) setLoadError(message);
        else setActionError(message);
      } finally {
        if (initial) setLoading(false);
      }
    },
    [isAdmin],
  );

  useEffect(() => {
    void fetchAll(true);
  }, [fetchAll]);

  async function refresh() {
    await fetchAll(false);
  }

  function startCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
    setActionError(null);
    setNotice(null);
  }

  function startEdit(flag: Flag) {
    setEditing(flag);
    setForm(toForm(flag));
    setFormOpen(true);
    setActionError(null);
    setNotice(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('save');
    setActionError(null);
    setNotice(null);

    const payload = {
      key: form.key.trim().toLowerCase(),
      name: form.name.trim(),
      description: form.description.trim(),
      enabled: form.enabled,
      rolloutPercentage: Number(form.rolloutPercentage),
      targetUsers: parseList(form.targetUsers),
      targetTenants: parseList(form.targetTenants),
    };

    try {
      if (editing) {
        const response = await fetch(`/api/flags/${editing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, version: editing.version }),
        });
        await readJson(response);
        setNotice(`Đã cập nhật ${payload.key} (version ${editing.version + 1}).`);
      } else {
        const response = await fetch('/api/flags', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await readJson<{ flag: Flag }>(response);
        setNotice(`Đã tạo flag ${data.flag.key}.`);
      }
      setFormOpen(false);
      setEditing(null);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không lưu được flag.';
      setActionError(message);
      if (editing && message.includes('người khác sửa')) {
        const response = await fetch('/api/flags', { cache: 'no-store' }).catch(() => null);
        if (response?.ok) {
          const data = (await response.json()) as { flags: Flag[] };
          const latest = data.flags.find((item) => item.id === editing.id);
          if (latest) setEditing(latest);
          setFlags(data.flags);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleFlag(flag: Flag) {
    setBusy(`toggle-${flag.id}`);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/flags/${flag.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: flag.key,
          name: flag.name,
          description: flag.description,
          enabled: !flag.enabled,
          rolloutPercentage: flag.rollout_percentage,
          targetUsers: flag.target_users,
          targetTenants: flag.target_tenants,
          version: flag.version,
        }),
      });
      await readJson(response);
      setNotice(`${flag.enabled ? 'Đã tắt' : 'Đã bật'} ${flag.key}.`);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Không đổi được trạng thái.');
    } finally {
      setBusy(null);
    }
  }

  async function removeFlag(flag: Flag) {
    if (!window.confirm(`Xoá flag "${flag.key}"? Hành động này không hoàn tác được.`)) return;
    setBusy(`delete-${flag.id}`);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/flags/${flag.id}`, { method: 'DELETE' });
      await readJson(response);
      setNotice(`Đã xoá ${flag.key}.`);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Không xoá được flag.');
    } finally {
      setBusy(null);
    }
  }

  async function evaluate() {
    setBusy('evaluate');
    setActionError(null);
    try {
      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: evalUserId.trim() || undefined,
          tenantId: evalTenantId.trim() || undefined,
        }),
      });
      const data = await readJson<{ evaluations: Evaluation[] }>(response);
      setEvaluations(data.evaluations);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Không evaluate được.');
    } finally {
      setBusy(null);
    }
  }

  async function runBenchmark() {
    setBusy('benchmark');
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/flags/benchmark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rounds: 2000 }),
      });
      const data = await readJson<{ run: BenchmarkRun }>(response);
      setBenchmark(data.run);
      setNotice(`Benchmark xong: p95 ${data.run.p95Ms.toFixed(3)} ms trên ${data.run.rounds} vòng.`);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Benchmark thất bại.');
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    setBusy('logout');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const latest = metrics?.latestBenchmark ?? null;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">HTK Feature Flags</p>
          <h1 className="mt-1 text-3xl font-semibold">Flag workspace</h1>
          <p className="mt-2 text-sm text-slate-400">
            {user.name} · {user.email} ·{' '}
            <span className="badge ml-1">{isAdmin ? 'admin' : 'viewer'}</span>
          </p>
        </div>
        <button className="btn-ghost" type="button" onClick={() => void logout()} disabled={busy === 'logout'}>
          {busy === 'logout' ? 'Đang thoát…' : 'Đăng xuất'}
        </button>
      </header>

      <div className="mt-4 space-y-2" aria-live="polite">
        {notice && (
          <p role="status" className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
            {notice}
          </p>
        )}
        {actionError && (
          <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {actionError}
          </p>
        )}
        {!isAdmin && (
          <p className="rounded-xl border border-line bg-panel/60 px-3 py-2 text-sm text-slate-400">
            Bạn đang ở quyền viewer: xem flag, evaluate và đọc SDK snapshot; mọi thao tác ghi sẽ bị API trả 403.
          </p>
        )}
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Đang tải dữ liệu">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="card animate-pulse">
              <div className="h-3 w-24 rounded bg-line/70" />
              <div className="mt-3 h-7 w-16 rounded bg-line/70" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="card mt-6" role="alert">
          <h2 className="text-lg font-semibold">Không tải được workspace</h2>
          <p className="mt-2 text-sm text-rose-200">{loadError}</p>
          <button className="btn-primary mt-4" type="button" onClick={() => void fetchAll(true)}>
            Thử lại
          </button>
        </div>
      ) : (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chỉ số">
            <MetricCard label="Tổng flags" value={metrics ? String(metrics.flags.total) : '—'} hint="trong database" />
            <MetricCard
              label="Đang bật"
              value={metrics ? String(metrics.flags.enabled) : '—'}
              hint={metrics ? `${metrics.flags.total - metrics.flags.enabled} đang tắt` : ''}
            />
            <MetricCard
              label="Rollout một phần"
              value={metrics ? String(metrics.flags.partial) : '—'}
              hint="1–99%"
            />
            <MetricCard
              label="Có targeting"
              value={metrics ? String(metrics.flags.targeted) : '—'}
              hint="user hoặc tenant"
            />
            <MetricCard
              label="p95 evaluate"
              value={latest ? `${latest.p95Ms.toFixed(3)} ms` : 'chưa đo'}
              hint={latest ? `${latest.rounds.toLocaleString('vi-VN')} vòng · ngân sách 50 ms` : 'chạy benchmark bên dưới'}
              tone={latest ? (latest.underBudget ? 'good' : 'bad') : undefined}
            />
            <MetricCard label="SDK cache hit" value={hitRate(latest)} hint="ước tính từ lượt benchmark gần nhất" />
            <MetricCard
              label="Evaluate requests"
              value={metrics ? metrics.traffic.evaluations.toLocaleString('vi-VN') : '—'}
              hint="đã phục vụ"
            />
            <MetricCard
              label="SDK fetches"
              value={metrics ? metrics.traffic.sdkFetches.toLocaleString('vi-VN') : '—'}
              hint="endpoint /api/sdk/flags"
            />
          </section>
          <p className="mt-2 text-xs text-slate-500">
            Request latency p50 {formatMs(metrics?.requestLatencyMs.p50 ?? null)} · p95{' '}
            {formatMs(metrics?.requestLatencyMs.p95 ?? null)} trên {metrics?.requestLatencyMs.samples ?? 0} mẫu gần nhất.
          </p>

          <section className="mt-8" aria-labelledby="flags-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="flags-heading" className="text-xl font-semibold">
                  Flags
                </h2>
                <p className="text-sm text-slate-400">Sửa bằng optimistic versioning; xung đột trả 409.</p>
              </div>
              {isAdmin && (
                <button className="btn-primary" type="button" onClick={startCreate}>
                  Tạo flag
                </button>
              )}
            </div>

            {formOpen && isAdmin && (
              <form className="card mt-4" onSubmit={submitForm} aria-label={editing ? 'Sửa flag' : 'Tạo flag'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{editing ? `Sửa ${editing.key}` : 'Flag mới'}</h3>
                  {editing && <span className="badge">version {editing.version}</span>}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="flag-key">Key</label>
                    <input
                      id="flag-key"
                      className="input"
                      value={form.key}
                      onChange={(event) => setForm({ ...form, key: event.target.value })}
                      placeholder="new-checkout"
                      pattern="[a-z0-9][a-z0-9-]{1,49}"
                      minLength={2}
                      maxLength={50}
                      required
                      autoFocus
                    />
                    <p className="mt-1 text-xs text-slate-500">a-z, 0-9, dấu gạch ngang; 2–50 ký tự.</p>
                  </div>
                  <div>
                    <label className="label" htmlFor="flag-name">Tên</label>
                    <input
                      id="flag-name"
                      className="input"
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      minLength={2}
                      maxLength={80}
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label" htmlFor="flag-description">Mô tả</label>
                    <input
                      id="flag-description"
                      className="input"
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      maxLength={280}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="flag-rollout">Rollout (%)</label>
                    <input
                      id="flag-rollout"
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      value={form.rolloutPercentage}
                      onChange={(event) => setForm({ ...form, rolloutPercentage: Number(event.target.value) })}
                      required
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="flag-users">Target users</label>
                    <input
                      id="flag-users"
                      className="input"
                      value={form.targetUsers}
                      onChange={(event) => setForm({ ...form, targetUsers: event.target.value })}
                      placeholder="user-42, user-demo"
                    />
                    <p className="mt-1 text-xs text-slate-500">Cách nhau bằng dấu phẩy.</p>
                  </div>
                  <div>
                    <label className="label" htmlFor="flag-tenants">Target tenants</label>
                    <input
                      id="flag-tenants"
                      className="input"
                      value={form.targetTenants}
                      onChange={(event) => setForm({ ...form, targetTenants: event.target.value })}
                      placeholder="acme, globex"
                    />
                  </div>
                  <label className="flex items-center gap-3 self-end rounded-xl border border-line bg-ink/50 px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-400"
                      checked={form.enabled}
                      onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                    />
                    Bật flag này
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn-primary" type="submit" disabled={busy === 'save'}>
                    {busy === 'save' ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo flag'}
                  </button>
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => {
                      setFormOpen(false);
                      setEditing(null);
                    }}
                    disabled={busy === 'save'}
                  >
                    Huỷ
                  </button>
                </div>
              </form>
            )}

            {flags.length === 0 ? (
              <div className="card mt-4">
                <p className="font-medium">Chưa có flag nào.</p>
                <p className="mt-1 text-sm text-slate-400">
                  {isAdmin ? 'Tạo flag đầu tiên để bắt đầu rollout.' : 'Admin chưa tạo flag nào.'}
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {flags.map((flag) => (
                  <article key={flag.id} className="card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold">{flag.name}</h3>
                        <code className="text-sm text-accent">{flag.key}</code>
                      </div>
                      <span
                        className={`badge ${
                          flag.enabled
                            ? 'border-emerald-400/40 text-emerald-300'
                            : 'border-slate-500/40 text-slate-400'
                        }`}
                      >
                        {flag.enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                    <p className="mt-2 min-h-[2.5rem] text-sm text-slate-400">{flag.description || 'Không có mô tả.'}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-slate-500">Rollout</dt>
                        <dd className="font-semibold">{flag.rollout_percentage}%</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Users</dt>
                        <dd className="font-semibold">{flag.target_users.length}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Tenants</dt>
                        <dd className="font-semibold">{flag.target_tenants.length}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Version</dt>
                        <dd className="font-semibold">{flag.version}</dd>
                      </div>
                    </dl>
                    {(flag.target_users.length > 0 || flag.target_tenants.length > 0) && (
                      <p className="mt-2 break-words text-xs text-slate-500">
                        target: {[...flag.target_users, ...flag.target_tenants].join(', ')}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      cập nhật {formatDate(flag.updated_at)} bởi {flag.updated_by ?? 'không rõ'}
                    </p>
                    {isAdmin && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => void toggleFlag(flag)}
                          disabled={busy === `toggle-${flag.id}`}
                        >
                          {busy === `toggle-${flag.id}` ? 'Đang lưu…' : flag.enabled ? 'Tắt' : 'Bật'}
                        </button>
                        <button className="btn-ghost" type="button" onClick={() => startEdit(flag)}>
                          Sửa
                        </button>
                        <button
                          className="btn-ghost border-rose-500/40 text-rose-200 hover:border-rose-400"
                          type="button"
                          onClick={() => void removeFlag(flag)}
                          disabled={busy === `delete-${flag.id}`}
                        >
                          {busy === `delete-${flag.id}` ? 'Đang xoá…' : 'Xoá'}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <section className="card" aria-labelledby="evaluate-heading">
              <h2 id="evaluate-heading" className="text-xl font-semibold">Evaluate</h2>
              <p className="mt-1 text-sm text-slate-400">
                Chạy đúng hàm mà SDK dùng; bucket được tính từ key + identity.
              </p>
              <form
                className="mt-4 grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void evaluate();
                }}
              >
                <div>
                  <label className="label" htmlFor="eval-user">User ID</label>
                  <input
                    id="eval-user"
                    className="input"
                    value={evalUserId}
                    onChange={(event) => setEvalUserId(event.target.value)}
                    placeholder="user-demo"
                    maxLength={64}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="eval-tenant">Tenant ID</label>
                  <input
                    id="eval-tenant"
                    className="input"
                    value={evalTenantId}
                    onChange={(event) => setEvalTenantId(event.target.value)}
                    placeholder="acme"
                    maxLength={64}
                  />
                </div>
                <div className="sm:col-span-2">
                  <button className="btn-primary" type="submit" disabled={busy === 'evaluate'}>
                    {busy === 'evaluate' ? 'Đang evaluate…' : 'Evaluate tất cả flags'}
                  </button>
                </div>
              </form>

              {evaluations === null ? (
                <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-slate-500">
                  Chưa có kết quả. Nhập user/tenant rồi chạy evaluate.
                </p>
              ) : evaluations.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">Không có flag nào để evaluate.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {evaluations.map((evaluation) => (
                    <li
                      key={evaluation.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink/40 px-3 py-2 text-sm"
                    >
                      <div>
                        <code className="text-accent">{evaluation.key}</code>
                        <p className="text-xs text-slate-500">
                          {REASON_LABEL[evaluation.reason]}
                          {evaluation.bucket !== null ? ` · bucket ${evaluation.bucket}` : ''} · v{evaluation.version}
                        </p>
                      </div>
                      <span
                        className={`badge ${
                          evaluation.value
                            ? 'border-emerald-400/40 text-emerald-300'
                            : 'border-slate-500/40 text-slate-400'
                        }`}
                      >
                        {evaluation.value ? 'on' : 'off'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="benchmark-heading">
              <h2 id="benchmark-heading" className="text-xl font-semibold">Benchmark &amp; SDK cache</h2>
              <p className="mt-1 text-sm text-slate-400">
                2.000 vòng evaluate qua SDK client có cache TTL 60 giây; đo p50/p95 so với ngân sách 50 ms.
              </p>
              {isAdmin ? (
                <button className="btn-primary mt-4" type="button" onClick={() => void runBenchmark()} disabled={busy === 'benchmark'}>
                  {busy === 'benchmark' ? 'Đang chạy…' : 'Chạy benchmark 2.000 vòng'}
                </button>
              ) : (
                <p className="mt-4 text-sm text-slate-500">Chỉ admin được chạy benchmark; viewer vẫn xem được số đo gần nhất.</p>
              )}

              {benchmark ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-line bg-ink/50 p-3">
                    <dt className="text-slate-400">p50</dt>
                    <dd className="mt-1 text-xl font-semibold">{benchmark.p50Ms.toFixed(3)} ms</dd>
                  </div>
                  <div className="rounded-xl border border-line bg-ink/50 p-3">
                    <dt className="text-slate-400">p95</dt>
                    <dd className={`mt-1 text-xl font-semibold ${benchmark.underBudget ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {benchmark.p95Ms.toFixed(3)} ms
                    </dd>
                  </div>
                  <div className="rounded-xl border border-line bg-ink/50 p-3">
                    <dt className="text-slate-400">Cache</dt>
                    <dd className="mt-1 text-lg font-semibold">{benchmark.cache.hits} hit</dd>
                    <dd className="text-xs text-slate-500">{benchmark.cache.misses} miss · {benchmark.cache.loads} load</dd>
                  </div>
                  <div className="rounded-xl border border-line bg-ink/50 p-3">
                    <dt className="text-slate-400">Khối lượng</dt>
                    <dd className="mt-1 text-lg font-semibold">{benchmark.evaluations.toLocaleString('vi-VN')}</dd>
                    <dd className="text-xs text-slate-500">{benchmark.flags} flags · scan {benchmark.scanMs} ms</dd>
                  </div>
                </dl>
              ) : latest ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-line bg-ink/50 p-3">
                    <dt className="text-slate-400">p95 gần nhất</dt>
                    <dd className="mt-1 text-xl font-semibold">{latest.p95Ms.toFixed(3)} ms</dd>
                  </div>
                  <div className="rounded-xl border border-line bg-ink/50 p-3">
                    <dt className="text-slate-400">Cache hit</dt>
                    <dd className="mt-1 text-xl font-semibold">{hitRate(latest)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-slate-500">
                  Chưa có lần đo nào. Chạy benchmark để ghi số thật.
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                SDK: <code>createFlagClient(loader, {'{ ttlMs: 30000 }'})</code> giữ snapshot trong TTL, dedupe
                request đồng thời và dùng dữ liệu cũ khi refresh lỗi.
              </p>
            </section>
          </div>

          {isAdmin && (
            <section className="mt-8 card" aria-labelledby="audit-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="audit-heading" className="text-xl font-semibold">Audit log</h2>
                  <p className="text-sm text-slate-400">50 thao tác gần nhất; gồm cả đăng ký và benchmark.</p>
                </div>
                <span className="badge">{metrics?.auditEvents ?? 0} events</span>
              </div>
              {!audit || audit.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-slate-500">
                  Chưa có sự kiện audit.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-line/70">
                  {audit.map((log, index) => (
                    <li key={`${log.created_at}-${index}`} className="py-3 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p>
                          <span className="font-semibold text-slate-200">{log.action}</span>{' '}
                          <span className="text-slate-500">bởi {log.actor}</span>
                        </p>
                        <time className="text-xs text-slate-500" dateTime={log.created_at}>{formatDate(log.created_at)}</time>
                      </div>
                      <p className="mt-1 break-words font-mono text-xs text-slate-500">{JSON.stringify(log.detail)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-slate-500">
        <span>HTK 0396241674 · feature flags case study</span>
        <span>Next.js · PGlite · Vercel Blob · Vitest</span>
      </footer>
    </main>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="card">
      <p className="text-sm text-slate-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : ''
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
