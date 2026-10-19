'use client';

import { useState } from 'react';
import { btnGhost, inputClass } from './ui';
import { ProposeStudentButton } from './ProposeStudentButton';

/** Bolaget väljer vilket publicerat behov en sökbar student ska föreslås för (§ 54). */
export function ProposeToNeedPicker({ studentId, needs, taken }: { studentId: string; needs: Array<{ id: string; title: string }>; taken: ReadonlySet<string> }) {
  const available = needs.filter((n) => !taken.has(n.id));
  const [needId, setNeedId] = useState(available[0]?.id ?? '');
  if (available.length === 0) return <span className="text-xs text-foreground-subtle">{needs.length === 0 ? 'Publicera ett behov först' : 'Redan föreslagen för era behov'}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={needId} onChange={(e) => setNeedId(e.target.value)} className={`${inputClass} max-w-xs`}>
        {available.map((n) => (
          <option key={n.id} value={n.id}>
            {n.title}
          </option>
        ))}
      </select>
      {needId ? <ProposeStudentButton key={needId} needId={needId} studentId={studentId} compact /> : <span className={btnGhost}>–</span>}
    </div>
  );
}
