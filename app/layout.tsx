import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'MUEBLESINTRA · Motor de planta',
  description: 'Tablero en vivo del motor MUEBLESINTRA (Supabase + RLS): pedidos, producción por estación, inventario y costos.',
};

export const viewport: Viewport = { themeColor: '#2563EB' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-MX" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
