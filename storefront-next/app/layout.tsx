import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hiro Store — Your Game. Your World. Your Store.',
  description: 'A premium destination for game top-ups, passes and digital goods.',
  applicationName: 'Hiro Store',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
