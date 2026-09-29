/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 41 — Kontaktboken. Utökar `contacts` (1700000071) från ett rent
// CRM-register till Movexums gemensamma kontaktbok:
//   • `owners`       — en eller flera INTERNA ägare (relation → users, multi).
//                      Ägaren är den kollega som "har" relationen och som
//                      avgör förfrågningar om att använda kontakten (§ 45.3).
//                      required:false i schemat (legacy-rader saknar ägare);
//                      skrivlagret kräver minst en ägare vid skapande.
//   • `organization` — organisationen kontakten företräder (text, ej PII).
//   • `category`     — fast vokabulär (MÅSTE spegla CONTACT_CATEGORIES i
//                      packages/shared/src/contacts.ts).
//   • `created_by`   — vem som lade in kontakten (intern användarrelation).
//   • autodate `created`/`updated` (saknades — PB v0.23 auto-lägger dem inte,
//     § 28.5; utan dem 400:ar sort `-created`).
//   • `last_name` görs VALFRITT (var required) — kontakter läggs ofta in med
//     ett namn ("Anna på Vinnova") eller från Outlook-export med ett namnfält.
//
// Reglerna rörs inte här (list/view = staff/observer sedan 1700000112,
// createRule roll-lös sedan 1700000111, `:each ?=` sedan 1700000108/127).
// GDPR: inga nya personuppgifter — ägare/skapare är interna användare,
// organisation/kategori är verksamhetsdata. E-post/telefon/gender är
// oförändrat fältmaskade i AI-kontexten (§ 9.3).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('contacts');
    const usersCol = app.findCollectionByNameOrId('users');

    const ensure = (field) => {
      if (!col.fields.getByName(field.name)) col.fields.add(new Field(field));
    };

    ensure({ name: 'created', type: 'autodate', onCreate: true, onUpdate: false });
    ensure({ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true });
    ensure({
      name: 'owners',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 20
    });
    ensure({ name: 'organization', type: 'text', required: false, max: 200 });
    ensure({
      name: 'category',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: [
        'investerare',
        'radgivare',
        'myndighet',
        'partner',
        'akademi',
        'media',
        'leverantor',
        'alumn',
        'annan'
      ]
    });
    ensure({
      name: 'created_by',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });

    // Efternamn blir valfritt: kontaktboken tar emot "Anna på Vinnova" från
    // chatten och Outlook-exporter med bara ett namnfält (§ 45.2).
    const lastName = col.fields.getByName('last_name');
    if (lastName) {
      lastName.required = false;
      lastName.min = 0;
    }

    const indexes = Array.isArray(col.indexes) ? [...col.indexes] : [];
    const idx = 'CREATE INDEX idx_contacts_tenant_category ON contacts (tenant, category)';
    if (!indexes.some((i) => String(i).includes('idx_contacts_tenant_category'))) indexes.push(idx);
    col.indexes = indexes;

    return app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('contacts');
    for (const name of ['owners', 'organization', 'category', 'created_by']) {
      const f = col.fields.getByName(name);
      if (f) col.fields.removeById(f.id);
    }
    col.indexes = (Array.isArray(col.indexes) ? col.indexes : []).filter(
      (i) => !String(i).includes('idx_contacts_tenant_category')
    );
    return app.save(col);
  }
);
