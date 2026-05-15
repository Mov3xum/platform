export const PB_COLLECTIONS = {
  // These IDs are explicitly defined in PocketBase migrations (not random runtime IDs).
  workshops: 'workshops_collection',
  workshopAssignments: 'workshop_assignments_collection',
  workshopRuns: 'workshop_runs_collection',
  strategies: 'strategies_collection',
  strategyRevisions: 'strategy_revisions_collection'
} as const;
