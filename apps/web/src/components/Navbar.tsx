import Link from "next/link";

const navItems = [
  { href: "/#tjanster", label: "Tjänster" },
  { href: "/#program", label: "Program" },
];

export function Navbar() {
  return (
    <nav className="border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-8">
        <Link href="/" className="flex items-center gap-3 text-xl font-semibold tracking-tight text-slate-950">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-600 text-white">M</span>
          movexum
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm font-medium text-slate-600 transition hover:text-slate-950">
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button className="hidden rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 md:inline-flex">
            EN
          </button>
          <button className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            <span className="sr-only">Sök</span>
            🔍
          </button>
          <Link
            href="/dashboard"
            className="hidden rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 md:inline-flex"
          >
            Väx med oss
          </Link>
        </div>
      </div>
    </nav>
  );
}
