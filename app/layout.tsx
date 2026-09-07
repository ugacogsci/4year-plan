import type { Metadata } from 'next';
import './globals.css';

const title = 'UGA Four Year Planner';
const description =
  'A visual, editable degree-planning prototype built from the UGA Semantic Course Map.';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
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
        alt: 'UGA Four Year Planner course constellation',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
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
