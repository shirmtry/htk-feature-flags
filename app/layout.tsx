import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HTK Feature Flags — targeting, SDK cache, audit',
  description:
    'Feature flag service với percentage rollout, targeting user/tenant, SDK client cache, phân quyền admin/viewer và audit log.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
