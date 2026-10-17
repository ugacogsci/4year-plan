import type { Metadata } from 'next';
import './globals.css';

/**
 * School-neutral, because the student picks the school in onboarding.
 * The previous title named one university over another university's catalog.
 */
const title = 'ORION';
const description =
  'Explore courses. Shape your semesters. An independent, visual degree planner for UGA and Illinois.';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://orion.cogsci.workers.dev';
const preview = '/orion-social-preview.jpg';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'ORION',
    title,
    description,
    images: [
      {
        url: preview,
        width: 1200,
        height: 630,
        alt: 'ORION - explore courses and shape your semesters at UGA and Illinois',
      },
    ],
  },
  twitter: { card: 'summary_large_image', title, description, images: [preview] },
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
