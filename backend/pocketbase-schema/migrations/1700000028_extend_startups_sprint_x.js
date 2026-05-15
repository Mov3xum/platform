/// <reference path="../pb_data/types.d.ts" />

// Lägger till sprint_x (4 axlar) + sector + pitch + next_milestone på startups
// så att Startupkompassen kan visa radarcharts och pitch-rader.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('startups');

    // sprint_x_json: { funding: 0-100, intl: 0-100, sustain: 0-100, team: 0-100 }
    collection.fields.add(
      new Field({
        name: 'sprint_x_json',
        type: 'json',
        required: false,
        maxSize: 4000
      })
    );

    collection.fields.add(
      new Field({
        name: 'sector',
        type: 'text',
        required: false,
        max: 200
      })
    );

    collection.fields.add(
      new Field({
        name: 'pitch',
        type: 'text',
        required: false,
        max: 500
      })
    );

    collection.fields.add(
      new Field({
        name: 'next_milestone',
        type: 'text',
        required: false,
        max: 200
      })
    );

    collection.fields.add(
      new Field({
        name: 'team_size',
        type: 'number',
        required: false,
        min: 0,
        max: 1000
      })
    );

    collection.fields.add(
      new Field({
        name: 'accent',
        type: 'text',
        required: false,
        max: 50
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('startups');
    for (const name of ['sprint_x_json', 'sector', 'pitch', 'next_milestone', 'team_size', 'accent']) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field.id);
    }
    return app.save(collection);
  }
);
