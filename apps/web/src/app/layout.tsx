import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moveum Incubator Platform",
  description: "Modulär plattform för Movexums inkubatorer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased">
        {children}
      </body>
    </html>
  );
}
