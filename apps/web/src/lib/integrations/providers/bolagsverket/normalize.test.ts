import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBolagsverketCompany } from './normalize';

const response = {
  organisationer: [
    {
      identitetsbeteckning: '5595728790',
      organisationsnamn: {
        organisationsnamnLista: [
          { namn: 'Combly Bifirma', organisationsnamntyp: { kod: 'SARSKILT_FORETAGSNAMN' } },
          { namn: 'Combly AB', organisationsnamntyp: { kod: 'FORETAGSNAMN' } }
        ]
      },
      organisationsform: { kod: 'AB', klartext: 'Aktiebolag' },
      organisationsdatum: { registreringsdatum: '2026-02-17' },
      naringsgrenOrganisation: { sni: [{ kod: '62010', klartext: 'Dataprogrammering' }] },
      postadressOrganisation: { postadress: { postort: 'GÄVLE', postnummer: '80320' } },
      sate: { kommun: { kod: '2180', klartext: 'Gävle' } }
    }
  ]
};

test('Bolagsverket → grunddata på bolagskortet', () => {
  const c = normalizeBolagsverketCompany('5595728790', response, false);
  assert.equal(c.name, 'Combly AB');
  assert.equal(c.startup.bolagsform, 'Aktiebolag');
  assert.equal(c.startup.company_registered_at, '2026-02-17');
  assert.equal(c.startup.sni_code, '62010');
  assert.equal(c.startup.industri, 'Dataprogrammering');
  assert.equal(c.startup.kommun, 'Gävle');
  assert.equal(c.startup.bolag_status, 'aktiv');
  assert.deepEqual(c.financials, []);
  assert.deepEqual(c.ownership, []);
  assert.deepEqual(c.notes, []);
});

test('avregistrerad organisation → status avregistrerat / konkurs', () => {
  const avreg = normalizeBolagsverketCompany(
    '5560000001',
    {
      organisationer: [
        {
          organisationsnamn: { organisationsnamnLista: [{ namn: 'Gammal AB' }] },
          organisationsdatum: { registreringsdatum: '2001-01-01', avregistreringsdatum: '2020-01-01' },
          avregistreradOrganisation: { avregistreringsorsak: { klartext: 'Konkurs avslutad' } }
        }
      ]
    },
    false
  );
  assert.equal(avreg.startup.bolag_status, 'konkurs');
  assert.ok(avreg.notes.some((n) => n.includes('SNI')));
});

test('tomt svar ger notes, inga fält', () => {
  const c = normalizeBolagsverketCompany('5595728790', { organisationer: [] }, false);
  assert.deepEqual(c.startup, {});
  assert.ok(c.notes.some((n) => n.includes('ingen organisation')));
});
