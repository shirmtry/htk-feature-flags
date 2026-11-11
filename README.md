# HTK Feature Flags

Feature flag service với percentage rollout ổn định, targeting user/tenant, SDK cache TTL + ETag, optimistic versioning và audit log.

- **Live:** https://htk-feature-flags.vercel.app
- **Tác giả:** HTK 0396241674

## Demo

**Live:** https://htk-feature-flags.vercel.app

**Chạy local trong 3 bước:**

```bash
npm install
cp .env.example .env.local   # để trống token để dùng PGlite file-backed
npm run dev                  # http://localhost:3000
```

Tài khoản demo:

| Vai trò | Email | Mật khẩu | Quyền |
| --- | --- | --- | --- |
| Admin | `demo@htk.dev` | `Demo12345!` | CRUD flag, benchmark, xem audit |
| Viewer | `viewer@htk.dev` | `Demo12345!` | Xem flag, evaluate, đọc SDK snapshot |

Seed sẵn 5 flag: `new-checkout` (35% + user), `dark-mode` (100%), `beta-reports` (10% + user/tenant), `maintenance-banner` (tắt), `ai-summary` (50% + tenant).

## Bài toán

Feature flag tưởng đơn giản cho đến khi cần trả lời ba câu cùng lúc: ai được bật tính năng, vì sao người đó được bật, và ai đã đổi cấu hình lúc nào. Một bảng `boolean` theo tên flag không đủ: cần rollout theo tỷ lệ ổn định, target theo user hoặc tenant, chống ghi đè khi hai admin sửa cùng lúc, và một SDK không được gọi database ở mỗi request. Nếu thiếu audit hoặc bucket không ổn định, cùng một người dùng có thể thấy tính năng bật/tắt thất thường sau mỗi lần deploy.

## Tính năng đang chạy

1. **Targeting 3 lớp:** thứ tự quyết định `disabled → target user → target tenant → percentage rollout → default`, cùng một hàm thuần dùng cho API evaluate và SDK.
2. **Bucket ổn định:** FNV-1a trên `flag key + identity` cho bucket 0–99; cùng user giữ nguyên bucket khi đổi rollout hoặc deploy lại.
3. **Admin CRUD + optimistic versioning:** PATCH gửi kèm `version`; bản cũ nhận `409 version_conflict` thay vì ghi đè im lặng; key trùng trả `409`.
4. **SDK client cache:** `createFlagClient(loader, { ttlMs })` cache snapshot theo TTL, dedupe request đồng thời, fallback dữ liệu cũ khi refresh lỗi và có `invalidate()`.
5. **SDK endpoint có ETag:** `GET /api/sdk/flags` trả `ETag`, hỗ trợ `If-None-Match` → `304`, kèm `Cache-Control` ngắn.
6. **Phân quyền admin/viewer:** UI ẩn thao tác ghi với viewer; API vẫn kiểm tra role và trả `403` nếu gọi trực tiếp.
7. **Audit + benchmark + rate limit:** mọi thay đổi được ghi audit; benchmark 2.000 vòng đo p50/p95 so với ngân sách 50 ms; các endpoint nhạy cảm bị giới hạn tần suất.

## Tech stack và trade-off

- **Next.js 15 App Router + React 19 + TypeScript:** API routes và UI trong cùng một deploy, không cần service thứ hai.
- **PGlite (PostgreSQL WASM):** chạy đúng SQL/Postgres ngay trong Vercel Node runtime, migration từ zero.
- **Vercel Blob private:** snapshot JSON của các bảng nghiệp vụ, đồng bộ bằng ETag; local dùng file PGlite.
- **zod:** validate toàn bộ input ở server, kể cả danh sách target.
- **Tailwind CSS:** layout responsive 375/1440, không phụ thuộc UI kit.
- **Vitest + PGlite:** test engine thuần, optimistic versioning và SDK cache trên Postgres thật.
- **scrypt + session cookie:** mật khẩu hash bằng `scrypt`, session httpOnly SameSite=Lax, hết hạn sau 7 ngày.

Ba trade-off thật:

1. **Vercel-only thay vì Postgres quản lý:** PGlite + Blob snapshot đủ cho demo và deploy một chạm, nhưng là mô hình single-writer last-write-wins. Tôi chấp nhận điều này để có live URL thật; hệ thống nhiều instance ghi đồng thời cần Postgres hoặc Redis thật.
2. **Rate limit lưu trong PGlite, không persist:** cửa sổ đếm reset khi cold start. Đổi lại không cần thêm Redis; đây là giới hạn đã biết, không phải cơ chế chống abuse cấp production.
3. **SDK cache TTL 30 giây:** flag mới có thể mất tối đa một TTL để lan truyền tới client đang cache. Phù hợp cho rollout theo giây/phút, không phù hợp cho kill-switch tức thời toàn hệ thống.

## Chạy local

Yêu cầu: Node.js 22+ (đã kiểm tra với Node 24.18).

```bash
npm install
cp .env.example .env.local
npm run dev
```

- Không có `BLOB_READ_WRITE_TOKEN` → dùng PGlite tại `./.data/pg`.
- Muốn dùng Blob: điền token private store vào `.env.local` (không commit file này).
- Database tự migrate và seed lần chạy đầu.

Build production:

```bash
npm run build
npm start
```

Docker:

```bash
docker build -t htk-feature-flags .
docker run -p 3000:3000 -v htk-flags-data:/data htk-feature-flags
```

## Kiểm thử

```bash
npm test
```

**14/14 test pass** (`lib/flags.test.ts`), gồm:

- bucket deterministic, nằm trong 0–99 và phân bố rộng;
- thứ tự ưu tiên disabled → user → tenant → rollout → default;
- rollout 100% vẫn cần identity; anonymous rơi về default;
- create/update/delete + audit + xung đột version;
- SDK cache hit/miss theo TTL, dedupe request đồng thời, stale fallback, invalidate.

Ngoài ra đã chạy E2E trên production bằng script Node (đăng nhập thật, cookie jar):

| Kiểm tra | Kết quả |
| --- | --- |
| `new-checkout` + `user-demo` | `true`, reason `user_target` |
| `new-checkout` + `user-77` ở rollout 35% | `false`, bucket 46 |
| `beta-reports` + tenant `acme` | `true`, reason `tenant_target` |
| PATCH với version cũ | `409 version_conflict` |
| Tạo key trùng | `409 key_taken` |
| Viewer POST/PATCH/DELETE/audit/benchmark | `403` |
| `GET /api/sdk/flags` + `If-None-Match` | `304` |
| Benchmark lần thứ 4 trong 1 phút | `429` |
| Health | `200`, persistence `vercel-blob` |

## Metrics / Evaluation

Đo ngày **2026-11-11** trên production Vercel (runtime Node, region iad1), bằng API benchmark thật:

- **2.000 vòng × 5 flags = 10.000 evaluation:** p50 **0,0023 ms**, p95 **0,0039 ms**, ngân sách p95 **< 50 ms** → pass.
- **SDK cache:** 2.000 hit / 1 miss / 1 load; thời gian đọc 5 flags từ PGlite (scan) **0,792 ms**.
- Benchmark chỉ đo phần evaluate sau khi snapshot đã nằm trong cache; không bao gồm network và cold start.
- **Request latency:** p50 **77 ms**, p95 **6.910 ms** trên **10 mẫu** gần nhất — p95 bị chi phối bởi cold start/first request, mẫu còn nhỏ, không dùng để khẳng định SLA.
- **Chưa đo:** throughput duy trì (req/s), độ trễ đồng bộ Blob giữa nhiều instance, và hành vi khi client SDK mất mạng kéo dài (mới test stale fallback ở unit test).

Chạy lại trên live: đăng nhập admin → workspace → **Chạy benchmark 2.000 vòng**.

## API chính

| Method | Path | Ghi chú |
| --- | --- | --- |
| GET | `/api/flags` | Session bắt buộc; trả role + canManage |
| POST | `/api/flags` | Admin; 20 lần/phút/user |
| PATCH | `/api/flags/:id` | Admin; cần `version`; 60 lần/phút/user |
| DELETE | `/api/flags/:id` | Admin; 20 lần/phút/user |
| GET | `/api/sdk/flags` | Session; ETag/304; 300 lần/phút/user |
| POST | `/api/evaluate` | Session; 600 lần/phút/user |
| POST | `/api/flags/benchmark` | Admin; 3 lần/phút/user |
| GET | `/api/metrics` | Session; số liệu thật từ DB |
| GET | `/api/audit` | Admin; 50 sự kiện gần nhất |
| GET | `/api/health` | Không cần auth |

## Cấu trúc

```text
app/
  api/            auth, flags CRUD, sdk, evaluate, benchmark, metrics, audit
  workspace/      trang quản trị (server component + client workspace)
  login, register
components/       Workspace, AuthForm
lib/              db, migrations, seed, flags engine, sdk, auth, rate limit, http
case-study.html   bản HTML của case study A4
case-study.pdf    bản PDF (6 trang)
```

## Giới hạn đã biết

- PGlite + Blob snapshot không thay thế Postgres cho ghi đồng thời quy mô lớn; last-write-wins có thể mất cập nhật nếu hai instance ghi sát nhau.
- Rate limit nằm trong bộ nhớ/DB tạm của từng instance và reset khi cold start.
- Chưa có soft delete hay version history của flag; audit lưu diff tóm tắt, không lưu toàn bộ snapshot trước/sau.
- PDF case study dùng tiếng Việt qua HTML/Chrome; README này là nguồn số liệu gốc.

---

**Tác giả:** HTK 0396241674 · case study feature flags · 2026
