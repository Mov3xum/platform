/// <reference path="../pb_data/types.d.ts" />

// Utökar `agreements` (1700000010/1700000076) med tilldelnings- och
// signeringsfält för det juridiskt giltiga in-app-signeringsflödet
// (avancerad elektronisk signatur, eIDAS art. 25–26):
//
//   • assigned_by / assigned_to        — staff som tilldelar + ev. utpekad
//                                          bolagssignatär (frivillig; vilken
//                                          länkad bolagsmedlem som helst kan
//                                          annars signera).
//   • sent_at                          — när avtalet skickades för signering.
//   • document_hash                    — SHA-256 (hex) av den uppladdade PDF:en.
//                                          DEN kanoniska bytes-hashen som varje
//                                          signatur attesterar → ändras filen
//                                          upptäcks det (eIDAS art. 26 d).
//   • requires_company/movexum_signature — vilka parter som måste signera.
//   • {company,movexum}_signed_{at,by} — denormaliserat för snabb kort-vy;
//                                          det rättsliga beviset ligger i
//                                          agreement_signatures (1700000094).
//
// Statusenumet får 'partially_signed' (en part klar, väntar på den andra).
// Inga PII-fält tillkommer som AI-kontexten läser — agreement_signatures
// denylistas i lib/ai/redaction.ts.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('agreements');
    const usersCol = app.findCollectionByNameOrId('users');

    const addField = (def) => {
      if (!collection.fields.getByName(def.name)) {
        collection.fields.add(new Field(def));
      }
    };

    addField({
      name: 'assigned_by',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    addField({
      name: 'assigned_to',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    addField({ name: 'sent_at', type: 'date', required: false });
    addField({ name: 'document_hash', type: 'text', required: false, max: 128 });
    addField({ name: 'requires_company_signature', type: 'bool', required: false });
    addField({ name: 'requires_movexum_signature', type: 'bool', required: false });
    addField({ name: 'company_signed_at', type: 'date', required: false });
    addField({
      name: 'company_signed_by',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });
    addField({ name: 'movexum_signed_at', type: 'date', required: false });
    addField({
      name: 'movexum_signed_by',
      type: 'relation',
      required: false,
      collectionId: usersCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    });

    // Lägg till 'partially_signed' i status-enumet (bevarar befintliga värden).
    const statusField = collection.fields.getByName('status');
    if (statusField && Array.isArray(statusField.values)) {
      if (!statusField.values.includes('partially_signed')) {
        statusField.values = [
          'draft',
          'sent',
          'partially_signed',
          'signed',
          'expired',
          'terminated'
        ];
      }
    }

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('agreements');
    for (const n of [
      'assigned_by',
      'assigned_to',
      'sent_at',
      'document_hash',
      'requires_company_signature',
      'requires_movexum_signature',
      'company_signed_at',
      'company_signed_by',
      'movexum_signed_at',
      'movexum_signed_by'
    ]) {
      const f = collection.fields.getByName(n);
      if (f) collection.fields.remove(f.id);
    }
    const statusField = collection.fields.getByName('status');
    if (statusField && Array.isArray(statusField.values)) {
      statusField.values = statusField.values.filter((v) => v !== 'partially_signed');
    }
    return app.save(collection);
  }
);
