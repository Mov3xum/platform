'use client';

import { useActionState } from 'react';
import { ARCHIVE_DESCRIPTION_SECTIONS, ARCHIVE_SECTION_MAX, RECORD_DIRECTION_LABELS, RECORD_HANDLING_LABELS, archiveDescriptionMissing } from '@platform/shared';
import type { ArchiveWorkspace } from '@/lib/register/data';
import { establishArchiveVersionAction, saveArchiveDescriptionAction, type RegisterActionState } from '@/lib/actions/register';
import { ActionNotice, Chip, Notice, btnGhost, btnPrimary, card, eyebrow, formatRegisterDate, inputClass, labelClass, retentionText } from '@/components/register/ui';

export function ArchiveView({ archive, canManage }: { archive: ArchiveWorkspace; canManage: boolean }) {
  const [descState, descAction, descPending] = useActionState<RegisterActionState, FormData>(saveArchiveDescriptionAction, {});
  const [verState, verAction, verPending] = useActionState<RegisterActionState, FormData>(establishArchiveVersionAction, {});
  const missing = archiveDescriptionMissing(archive.description);
  const total = archive.inventory.reduce((n, p) => n + p.count, 0);
  return (
    <div className="space-y-8">
      {archive.error && <Notice tone="bad">{archive.error}</Notice>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Arkivförteckning</h2>
            <p className="text-sm text-foreground-muted">
              Räknas ur planen och diariet varje gång sidan öppnas · {total} handlingar{archive.inventoryComplete ? '' : ' (minst)'}
            </p>
          </div>
          <button type="button" className={btnGhost} onClick={() => window.print()}>
            Skriv ut
          </button>
        </div>
        {archive.inventory.map((p) => (
          <div key={p.process} className="space-y-2">
            <h3 className={eyebrow}>
              {p.process} · {p.count}
            </h3>
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full min-w-[820px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[17%]" />
                  <col className="w-[9%]" />
                  <col className="w-[14%]" />
                  <col className="w-[13%]" />
                  <col className="w-[17%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-default text-xs text-foreground-subtle">
                    <th className="px-4 py-2 font-semibold">Handlingstyp</th>
                    <th className="px-3 py-2 font-semibold">Hantering</th>
                    <th className="px-3 py-2 text-right font-semibold">Antal</th>
                    <th className="px-3 py-2 font-semibold">Tidsspann</th>
                    <th className="px-3 py-2 font-semibold">Bevara / gallra</th>
                    <th className="px-3 py-2 font-semibold">Förvaring</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {p.rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-4 py-2">
                        <div className="text-foreground">{r.label}</div>
                        <div className="text-xs text-foreground-subtle">{RECORD_DIRECTION_LABELS[r.direction]}</div>
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">{RECORD_HANDLING_LABELS[r.handling]}</td>
                      <td className="mx-tnum px-3 py-2 text-right text-foreground">
                        {r.count}
                        {r.secrecy_count > 0 && <div className="text-xs text-foreground-subtle">{r.secrecy_count} sekretess</div>}
                      </td>
                      <td className="mx-tnum whitespace-nowrap px-3 py-2 text-foreground-muted">{r.first ? (r.first === r.last ? r.first : `${r.first} – ${r.last}`) : '–'}</td>
                      <td className="px-3 py-2 text-foreground-muted">{retentionText(r.retention, r.retention_months)}</td>
                      <td className="px-3 py-2 text-xs text-foreground-muted">{r.storage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Arkivbeskrivning</h2>
          <p className="text-sm text-foreground-muted">
            {archive.descriptionUpdatedAt ? `Senast ändrad ${formatRegisterDate(archive.descriptionUpdatedAt, true)}` : 'Inte ifylld än'}
            {missing.length > 0 && ` · ${missing.length} avsnitt saknas`}
          </p>
        </div>
        <form action={descAction} className={`${card} space-y-4 p-5`}>
          {ARCHIVE_DESCRIPTION_SECTIONS.map((sec) => (
            <label key={sec.key} className="block">
              <span className={labelClass}>{sec.label}</span>
              <textarea
                name={`section_${sec.key}`}
                defaultValue={archive.description[sec.key]}
                maxLength={ARCHIVE_SECTION_MAX}
                rows={3}
                readOnly={!canManage}
                placeholder={sec.hint}
                className={inputClass}
              />
            </label>
          ))}
          <ActionNotice state={descState} />
          {canManage && (
            <button className={btnPrimary} disabled={descPending}>
              {descPending ? 'Sparar…' : 'Spara beskrivningen'}
            </button>
          )}
        </form>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Fastställda versioner</h2>
          <p className="text-sm text-foreground-muted">En version fryser planen, förteckningen och beskrivningen med datum, vem som fastställde och kontrollsumma.</p>
        </div>
        {canManage && (
          <form action={verAction} className={`${card} flex flex-wrap items-end gap-3 p-5`}>
            <label className="min-w-[240px] flex-1">
              <span className={labelClass}>Beslut / anteckning</span>
              <input name="note" maxLength={400} className={inputClass} placeholder="T.ex. Beslutad av ledningsgruppen 2026-12-01" />
            </label>
            <button className={btnPrimary} disabled={verPending}>
              {verPending ? 'Fastställer…' : 'Fastställ ny version'}
            </button>
            <div className="w-full">
              <ActionNotice state={verState} />
            </div>
          </form>
        )}
        {archive.versions.length === 0 ? (
          <p className="text-sm text-foreground-muted">Ingen version är fastställd än.</p>
        ) : (
          <div className={`${card} divide-y divide-default`}>
            {archive.versions.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <Chip tone="info">Version {v.version}</Chip>
                <span className="mx-tnum text-foreground">{formatRegisterDate(v.establishedAt, true)}</span>
                <span className="text-foreground-muted">{v.establishedByName || 'Okänd'}</span>
                <span className="min-w-0 flex-1 truncate text-foreground-muted">{v.note}</span>
                <span className="text-xs text-foreground-subtle">{v.typeCount} typer</span>
                <code className="text-xs text-foreground-subtle" title={v.contentHash}>
                  {v.contentHash.slice(0, 12)}
                </code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
