import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { excellenceAssessmentFilename } from './assessment-file';

describe('excellenceAssessmentFilename', () => {
  it('bygger namn av bolag + svensk tidsstämpel', () => {
    const name = excellenceAssessmentFilename({
      subjectName: 'Combly AB',
      orgNr: '5591234567',
      assessedAt: '2026-10-12T12:05:00.000Z'
    });
    assert.equal(name, 'Bedömning excellens – Combly AB – 2026-10-12 14.05.pdf');
  });

  it('sanerar filsystemstecken och faller tillbaka på org-nr', () => {
    assert.equal(
      excellenceAssessmentFilename({ subjectName: 'A/B:C*"<x>|?', orgNr: '5591234567', assessedAt: '2026-01-02T00:00:00Z' }),
      'Bedömning excellens – A B C x – 2026-01-02 01.00.pdf'
    );
    assert.equal(
      excellenceAssessmentFilename({ orgNr: '5591234567', assessedAt: '2026-01-02T00:00:00Z' }),
      'Bedömning excellens – 5591234567 – 2026-01-02 01.00.pdf'
    );
  });

  it('kapar långa namn och tål ogiltigt datum', () => {
    const name = excellenceAssessmentFilename({ subjectName: 'x'.repeat(200), orgNr: '1', assessedAt: 'nope' });
    assert.ok(name.startsWith(`Bedömning excellens – ${'x'.repeat(60)} – okänt-datum.pdf`));
    assert.ok(name.length < 120);
  });
});
