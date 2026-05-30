export const PB_COLLECTIONS = {
  // These IDs are explicitly defined in PocketBase migrations (not random runtime IDs).
  workshops: 'workshops_collection',
  workshopAreas: 'workshop_areas_collection',
  workshopAssignments: 'workshop_assignments_collection',
  workshopRuns: 'workshop_runs_collection',
  workshopMedia: 'workshop_media_collection',
  educationDocuments: 'education_documents_collection',
  educationDocumentAssignments: 'education_document_assignments_collection',
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
  alumni: 'alumni_collection',
  missionComments: 'mission_comments_collection',
  notifications: 'notifications_collection',
  startupPhaseHistory: 'startup_phase_history_collection',
  // De minimis-modul (migrationer 1700000093–1700000095)
  deMinimisRegelverk: 'de_minimis_regelverk_collection',
  deMinimisUnits: 'de_minimis_units_collection',
  deMinimisUnitOrgnr: 'de_minimis_unit_orgnr_collection',
  deMinimisStod: 'de_minimis_stod_collection',
  agreements: 'agreements_collection',
  agreementSignatures: 'agreement_signatures_collection'
} as const;
