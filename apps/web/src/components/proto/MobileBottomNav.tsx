'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Icon } from './Icon';
import { useMobileRail } from './MobileRail';
import type { MobileNav, MobileNavItem } from '@/lib/mobile-nav';

/**
 * Bottom-meny för mobil/surfplatta (CLAUDE.md § 35). Fem platser med
 * chatten som upphöjd mittknapp; "Mer" öppnar den befintliga sidmenyn
 * (drawern) med hela navigationen och kontomenyn. Döljs på desktop via CSS.
 */
export function MobileBottomNav({ nav }: { nav: MobileNav }) {
  const pathname = usePathname();
  const { open, setOpen } = useMobileRail();

  // Dölj menyn medan ett textfält har fokus (tangentbordet uppe) så att
  // chattens komposer får hela den krympta viewporten. Body-klassen nollar
  // även --mx-bnav-total (prototype.css) så helhöjds-ytorna växer.
  useEffect(() => {
    const isTextField = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT') {
        const t = (el as HTMLInputElement).type;
        return !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes(t);
      }
      return false;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isTextField(e.target)) document.body.classList.add('mx-bnav-hidden');
    };
    const onFocusOut = () => {
      // Vänta ett tick: fokus kan hoppa direkt till ett annat textfält.
      setTimeout(() => {
        if (!isTextField(document.activeElement)) document.body.classList.remove('mx-bnav-hidden');
      }, 60);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.body.classList.remove('mx-bnav-hidden');
    };
  }, []);

  const isActive = (href: string) =>
    !open && (pathname === href || pathname.startsWith(href + '/'));

  const renderItem = (item: MobileNavItem) => (
    <Link
      key={item.id}
      href={item.href}
      className={`mx-bnav-item${isActive(item.href) ? ' active' : ''}`}
      aria-current={isActive(item.href) ? 'page' : undefined}
    >
      <span className="mx-bnav-ico">
        <Icon name={item.icon} size={22} />
        {item.count != null && item.count > 0 && (
          <span className="mx-bnav-badge" aria-label={`${item.count} nya`}>
            {item.count > 99 ? '99+' : item.count}
          </span>
        )}
      </span>
      <span className="mx-bnav-label">{item.label}</span>
    </Link>
  );

  return (
    <nav className="mx-bnav" aria-label="Snabbnavigation">
      {nav.left.map(renderItem)}

      <Link
        href={nav.center.href}
        className={`mx-bnav-center${isActive(nav.center.href) ? ' active' : ''}`}
        aria-current={isActive(nav.center.href) ? 'page' : undefined}
        aria-label={nav.center.label}
      >
        <span className="mx-bnav-center-btn">
          <Icon name={nav.center.icon} size={26} />
        </span>
        <span className="mx-bnav-label">{nav.center.label}</span>
      </Link>

      {nav.right.map(renderItem)}

      <button
        type="button"
        className={`mx-bnav-item${open ? ' active' : ''}`}
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="mx-rail"
      >
        <span className="mx-bnav-ico">
          <Icon name="menu" size={22} />
        </span>
        <span className="mx-bnav-label">Mer</span>
      </button>
    </nav>
  );
}
