import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Double Financing Preventer',
  description: 'Blockchain command center for the DoubleFinancingPreventer protocol',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23090b0f' width='100' height='100' rx='20'/><circle cx='50' cy='50' r='25' fill='none' stroke='%23f5a623' stroke-width='6'/><circle cx='50' cy='50' r='8' fill='%23f5a623'/></svg>" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
