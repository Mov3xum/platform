import { Navbar } from '../components/Navbar';
import './globals.css';

export const metadata = {
  title: 'Moveum Inkubatorplattform',
  description: 'Modulär plattform med startup-centrerad samlad information.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body style={{ fontFamily: 'Inter, sans-serif', margin: 0, background: '#f8fafc' }}>
        <Navbar />
        <main style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>{children}</main>
      </body>
    </html>
  );
}
