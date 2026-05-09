import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Markets Pro — AI Betting Analyst',
  description: 'Multi-sport betting analyst powered by Claude AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
