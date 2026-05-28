import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Double Financing Preventer',
  description: 'Frontend for the DoubleFinancingPreventer backend',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
