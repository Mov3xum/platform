'use client';

import type { CSSProperties, ReactNode } from 'react';

interface Props {
  /** Bekräftelsetexten som visas i dialogen innan formuläret skickas. */
  confirmText: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

// Submit-knapp som kräver en bekräftelsedialog innan formuläret postas.
// För destruktiva server-action-formulär i server-komponenter (radera lead,
// radera modul m.fl.) — samma window.confirm-mönster som appens övriga
// raderingsflöden (FilesBrowser, AgreementsSection, ScheduleEditor ...).
export function ConfirmSubmitButton({ confirmText, className, style, children }: Props) {
  return (
    <button
      type="submit"
      className={className}
      style={style}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
