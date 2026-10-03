import type { Metadata } from 'next';
import './globals.css';

/**
 * School-neutral, because the student picks the school in onboarding.
 * The previous title named one university over another university's catalog.
 */
const title = 'ORION';
const description =
  'Plan every semester against your own university catalog, prerequisites and schedule.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title,
  description,
  openGraph: {
    type: 'website',
    title,
    description,
    images: [
      {
        url: '/og.png',
        width: 1731,
        height: 909,
        alt: 'ORION course constellation',
      },
    ],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
