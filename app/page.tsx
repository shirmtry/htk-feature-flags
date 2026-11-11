import Link from 'next/link';

const FEATURES: Array<[string, string]> = [
  ['Targeting 3 lớp', 'Ưu tiên tắt → target user → target tenant → percentage → mặc định, cùng một hàm thuần.'],
  ['Bucket ổn định', 'FNV-1a trên key + identity: cùng user luôn rơi cùng bucket, không nhảy khi deploy.'],
  ['SDK cache + ETag', 'Client cache TTL, dedupe request đồng thời, fallback dữ liệu cũ; endpoint trả 304 khi không đổi.'],
  ['Optimistic versioning', 'PATCH kèm version; sửa đồng thời nhận 409 thay vì ghi đè im lặng.'],
  ['Admin / viewer', 'Admin CRUD và benchmark; viewer chỉ xem, evaluate và đọc SDK snapshot.'],
  ['Audit + benchmark', 'Mọi thay đổi được ghi audit; benchmark đo p50/p95 so với ngân sách 50 ms.'],
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">HTK Feature Flags</p>
          <p className="text-sm text-slate-400">Flag service with auditable targeting and a cached SDK.</p>
        </div>
        <nav className="flex items-center gap-3" aria-label="Tài khoản">
          <Link className="link text-sm" href="/login">Đăng nhập</Link>
          <Link className="btn-primary" href="/register">Tạo tài khoản</Link>
        </nav>
      </header>

      <section className="mt-16 grid gap-10 lg:grid-cols-[1.05fr,0.95fr] lg:items-center">
        <div>
          <span className="badge">Targeting · SDK cache · optimistic locking · audit</span>
          <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">
            Bật tính năng theo
            <br />
            đúng người, đúng tỷ lệ.
          </h1>
          <p className="mt-5 max-w-xl text-slate-300">
            Một feature flag service chạy thật: percentage rollout ổn định theo hash, target user và
            tenant, SDK client có cache TTL và ETag, cập nhật bằng optimistic versioning, phân quyền
            admin/viewer và audit log cho từng thay đổi.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="btn-primary" href="/login">Mở workspace demo</Link>
            <a className="btn-ghost" href="https://github.com/shirmtry/htk-feature-flags">
              GitHub
            </a>
          </div>
          <div className="mt-5 space-y-1 text-sm text-slate-400">
            <p>
              Admin: <code className="rounded bg-ink/70 px-1.5 py-0.5">demo@htk.dev</code> /{' '}
              <code className="rounded bg-ink/70 px-1.5 py-0.5">Demo12345!</code>
            </p>
            <p>
              Viewer: <code className="rounded bg-ink/70 px-1.5 py-0.5">viewer@htk.dev</code> /{' '}
              <code className="rounded bg-ink/70 px-1.5 py-0.5">Demo12345!</code>
            </p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Ví dụ quyết định</p>
              <p className="text-2xl font-semibold">new-checkout</p>
            </div>
            <span className="badge border-emerald-400/40 text-emerald-300">enabled</span>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-xl border border-line bg-ink/50 p-3">
              <dt className="text-slate-400">Rollout</dt>
              <dd className="mt-1 text-xl font-semibold">35%</dd>
              <dd className="text-xs text-slate-500">bucket &lt; 35</dd>
            </div>
            <div className="rounded-xl border border-line bg-ink/50 p-3">
              <dt className="text-slate-400">Target</dt>
              <dd className="mt-1 text-xl font-semibold">1 user</dd>
              <dd className="text-xs text-slate-500">user-demo</dd>
            </div>
            <div className="rounded-xl border border-line bg-ink/50 p-3">
              <dt className="text-slate-400">SDK cache</dt>
              <dd className="mt-1 text-xl font-semibold">30 s</dd>
              <dd className="text-xs text-slate-500">TTL + ETag 304</dd>
            </div>
            <div className="rounded-xl border border-line bg-ink/50 p-3">
              <dt className="text-slate-400">Ngân sách p95</dt>
              <dd className="mt-1 text-xl font-semibold">&lt; 50 ms</dd>
              <dd className="text-xs text-slate-500">đo bằng benchmark thật</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            Thẻ này minh hoạ seed data; workspace hiển thị trạng thái thật từ database.
          </p>
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Tính năng">
        {FEATURES.map(([title, body]) => (
          <article key={title} className="card">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-slate-400">{body}</p>
          </article>
        ))}
      </section>

      <section className="mt-16 card">
        <h2 className="text-xl font-semibold">Thử nhanh sau khi đăng nhập</h2>
        <ol className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
          <li className="rounded-xl border border-line bg-ink/40 p-4">
            1. Evaluate <code>new-checkout</code> với <code>userId=user-demo</code> để thấy target user thắng rollout.
          </li>
          <li className="rounded-xl border border-line bg-ink/40 p-4">
            2. Đổi rollout của một flag rồi chạy lại evaluate: bucket giữ nguyên, kết quả đổi theo ngưỡng.
          </li>
          <li className="rounded-xl border border-line bg-ink/40 p-4">
            3. Chạy benchmark 2.000 vòng: xem p50/p95 và cache hits của SDK client.
          </li>
          <li className="rounded-xl border border-line bg-ink/40 p-4">
            4. Đăng nhập viewer: nút sửa biến mất, API trả 403 nếu cố gọi PATCH.
          </li>
        </ol>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-slate-500">
        <span>HTK 0396241674 · case study feature flags</span>
        <span>Next.js · PGlite · Vercel Blob · Vitest</span>
      </footer>
    </main>
  );
}
