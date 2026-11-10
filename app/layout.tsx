import type { Metadata } from 'next';
import './globals.css';
import './redesign.css';
import './redesign/rail.css';
import './redesign/assistant.css';
import './redesign/overlays.css';
import './redesign/onboarding.css';
import './redesign/fixes.css';
import './redesign/look-editorial.css';
import './redesign/gatech.css';

/**
 * School-neutral, because the student picks the school in onboarding.
 * The previous title named one university over another university's catalog.
 */
const title = 'ORION';
const description =
  'Explore courses. Shape your semesters. An independent, visual degree planner for UGA, Illinois and Georgia Tech.';
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
        alt: 'ORION - explore courses and shape your semesters at UGA, Illinois and Georgia Tech',
      },
    ],
  },
  twitter: { card: 'summary_large_image', title, description, images: [preview] },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-look="editorial">
      <head>
        {/* Fonts: Inter for everything, Newsreader for the Editorial headings. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=Newsreader:opsz,wght@6..72,400..600&display=swap"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
