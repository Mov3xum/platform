export const PB_COLLECTIONS = {
  // These IDs are explicitly defined in PocketBase migrations (not random runtime IDs).
  workshops: 'workshops_collection',
  workshopAreas: 'workshop_areas_collection',
  workshopAssignments: 'workshop_assignments_collection',
  workshopRuns: 'workshop_runs_collection',
  strategies: 'strategies_collection',
  strategyRevisions: 'strategy_revisions_collection',
  // Movexum OS — utökning maj 2026
  missions: 'missions_collection',
  sprintXCheckins: 'sprint_x_checkins_collection',
  investors: 'investors_collection',
  deals: 'deals_collection',
  events: 'incubator_events_collection',
  eventSignups: 'event_signups_collection',
  reports: 'incubator_reports_collection',
  alumni: 'alumni_collection'
} as const;
