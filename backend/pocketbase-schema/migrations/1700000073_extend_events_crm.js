/// <reference path="../pb_data/types.d.ts" />

// Utökar incubator_events och event_signups med fält från Excel-arken
// "Aktiviteter" och "Deltagare".
//
// Designval (CLAUDE.md § 9.4): återanvänder befintlig
// `incubator_events`/`event_signups`-modell istället för att skapa
// parallellt `crm_activities`-schema. Bevarar /event-vyer, AI-agenter
// och RBAC. Excel-konceptet "Aktivitet" ⇔ vårt "event".
//
// Saknade fält ifylls per Excel-kolumn:
//   incubator_events:
//     • organizer        ← "Arrangör"           (text)
//     • target_audience  ← "Målgrupp för aktiviteten" (text)
//     • event_url        ← "Länk till event"    (url)
//     • internal_comment ← "Kommentar"          (editor, ej AI-säker)
//     • outcome          ← "Resultat"          (editor, AI-säker)
//     • owner            ← "Ansvarig"          (relation→users)
//     • participant_count← "Antal deltagare"    (number, denormaliserat
//                                                 räkneraggregat — UI
//                                                 kan visa snabbt utan
//                                                 att räkna event_signups)
//
//   event_signups:
//     • participant_kind ← "Deltagartyp"        (select: person|company)
//     • contact          ← relation→contacts    (när Deltagartyp=person)
//     • note             ← "Anteckning"         (text, ersätter notes-max)
//
// `notes` lever kvar för bakåtkompat — `note` (singular) speglar
// Excel-kolumnen och är fri text per signup.

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const contactsCol = app.findCollectionByNameOrId('contacts');

    // --- incubator_events ---
    const events = app.findCollectionByNameOrId('incubator_events');

    const addText = (col, name, max) => {
      if (!col.fields.getByName(name)) {
        col.fields.add(
          new Field({ name, type: 'text', required: false, max })
        );
      }
    };

    addText(events, 'organizer', 200);
    addText(events, 'target_audience', 200);

    if (!events.fields.getByName('event_url')) {
      events.fields.add(
        new Field({ name: 'event_url', type: 'url', required: false })
      );
    }

    if (!events.fields.getByName('internal_comment')) {
      events.fields.add(
        new Field({ name: 'internal_comment', type: 'editor', required: false })
      );
    }
    if (!events.fields.getByName('outcome')) {
      events.fields.add(
        new Field({ name: 'outcome', type: 'editor', required: false })
      );
    }

    if (!events.fields.getByName('owner')) {
      events.fields.add(
        new Field({
          name: 'owner',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    if (!events.fields.getByName('participant_count')) {
      events.fields.add(
        new Field({
          name: 'participant_count',
          type: 'number',
          required: false,
          min: 0
        })
      );
    }

    app.save(events);

    // --- event_signups ---
    const signups = app.findCollectionByNameOrId('event_signups');

    if (!signups.fields.getByName('participant_kind')) {
      signups.fields.add(
        new Field({
          name: 'participant_kind',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['person', 'company']
        })
      );
    }

    if (!signups.fields.getByName('contact')) {
      signups.fields.add(
        new Field({
          name: 'contact',
          type: 'relation',
          required: false,
          collectionId: contactsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    if (!signups.fields.getByName('note')) {
      signups.fields.add(
        new Field({ name: 'note', type: 'text', required: false, max: 2000 })
      );
    }

    app.save(signups);
  },
  (app) => {
    const events = app.findCollectionByNameOrId('incubator_events');
    for (const n of [
      'organizer',
      'target_audience',
      'event_url',
      'internal_comment',
      'outcome',
      'owner',
      'participant_count'
    ]) {
      const f = events.fields.getByName(n);
      if (f) events.fields.remove(f.id);
    }
    app.save(events);

    const signups = app.findCollectionByNameOrId('event_signups');
    for (const n of ['participant_kind', 'contact', 'note']) {
      const f = signups.fields.getByName(n);
      if (f) signups.fields.remove(f.id);
    }
    app.save(signups);
  }
);
