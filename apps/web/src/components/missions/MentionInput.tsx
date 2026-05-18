'use client';

import { useMemo, useRef, useState } from 'react';

export interface MentionUser {
  id: string;
  label: string;
}

interface MentionInputProps {
  name: string;
  placeholder?: string;
  users: MentionUser[];
  minRows?: number;
  defaultValue?: string;
}

/**
 * Textarea med "@"-autocomplete. Skickar markup i formatet
 * `@[Display Name](userId)` så server-actionen kan parsa mentions
 * exakt — utan att vi någonsin lagrar e-postadresser i body.
 */
export function MentionInput({
  name,
  placeholder,
  users,
  minRows = 3,
  defaultValue = ''
}: MentionInputProps) {
  const [value, setValue] = useState(defaultValue);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const filtered = useMemo(() => {
    if (openAt === null) return [];
    const q = query.toLowerCase();
    return users.filter((u) => u.label.toLowerCase().includes(q)).slice(0, 6);
  }, [openAt, query, users]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const caret = e.target.selectionStart;
    setValue(next);

    // Hitta sista "@" framför markören (utan mellanslag emellan)
    const before = next.slice(0, caret);
    const m = before.match(/(^|\s)@([\wåäöÅÄÖ-]{0,30})$/);
    if (m) {
      setOpenAt(caret - (m[2]?.length || 0) - 1);
      setQuery(m[2] || '');
    } else {
      setOpenAt(null);
      setQuery('');
    }
  }

  function applyMention(user: MentionUser) {
    if (openAt === null || !taRef.current) return;
    const ta = taRef.current;
    const start = openAt;
    const end = start + 1 + query.length; // "@" + query
    const before = value.slice(0, start);
    const after = value.slice(end);
    const insert = `@[${user.label}](${user.id}) `;
    const next = `${before}${insert}${after}`;
    setValue(next);
    setOpenAt(null);
    setQuery('');
    requestAnimationFrame(() => {
      const pos = (before + insert).length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={minRows}
        className="w-full rounded-xl border border-default bg-canvas px-3 py-2 text-[13.5px] text-foreground placeholder:text-foreground-subtle focus:border-brand focus:outline-none focus:ring-1 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
      />
      {openAt !== null && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-72 overflow-auto rounded-xl border border-default bg-surface p-1 shadow-lg shadow-movexum-svart/10"
        >
          {filtered.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(u);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-canvas-subtle"
              >
                <span className="font-mono text-[10.5px] text-foreground-subtle">@</span>
                <span>{u.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10.5px] text-foreground-subtle">
        Tips: skriv @ för att tagga en kollega. Tryck på namnet i listan.
      </p>
    </div>
  );
}
