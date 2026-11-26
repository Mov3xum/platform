/** Diariets vyer (flikar via `?vy=`). Ren modul — delas av sidan och klienterna. */
export const REGISTER_VIEWS = [
  { id: 'diarium', label: 'Diarium' },
  { id: 'plan', label: 'Plan' },
  { id: 'forteckning', label: 'Förteckning' },
  { id: 'utlamnanden', label: 'Utlämnanden' },
  { id: 'granskning', label: 'Granskning' }
] as const;
export type RegisterViewId = (typeof REGISTER_VIEWS)[number]['id'];

export function parseRegisterView(v: unknown): RegisterViewId {
  return REGISTER_VIEWS.some((x) => x.id === v) ? (v as RegisterViewId) : 'diarium';
}

export function registerViewHref(id: RegisterViewId): string {
  return id === 'diarium' ? '/diarium' : `/diarium?vy=${id}`;
}
