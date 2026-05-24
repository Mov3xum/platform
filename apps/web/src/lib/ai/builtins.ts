// Källa av sanning för Mistrals first-party "built-in tools".
// CLAUDE.md § 10.1 (EU AI Act art. 11): riskklass dokumenteras per agent.
// CLAUDE.md § 11.3: residency dokumenteras per integration.

export type BuiltinId =
  | 'web_search'
  | 'code_interpreter'
  | 'image_generation'
  | 'document_library';

export interface BuiltinMeta {
  id: BuiltinId;
  label: string;
  blurb: string;
  riskClass: 'minimal' | 'begränsad' | 'högrisk';
  residency: 'FR/EU';
  // Om true: kostnadsdrivande connector som måste explicit aktiveras av admin
  // i tenant-allowlistan innan slutanvändare kan opt:a in.
  costSensitive: boolean;
  // Vilka modeller stöder denna built-in i Mistrals tool-spec.
  modelHint: string;
  icon: string;
}

export const BUILTINS: BuiltinMeta[] = [
  {
    id: 'web_search',
    label: 'Mistral Web Search',
    blurb:
      'Sök realtidsinformation från nyhetskällor och webben. Citationer ' +
      'loggas i körningen för granskning.',
    riskClass: 'begränsad',
    residency: 'FR/EU',
    costSensitive: false,
    modelHint: 'Large eller Medium',
    icon: '🔎'
  },
  {
    id: 'code_interpreter',
    label: 'Code Interpreter',
    blurb:
      'Kör Python i Mistrals sandbox för dataanalys, beräkningar och ' +
      'visualisering. Indata och kod skickas till Mistrals EU-sandbox.',
    riskClass: 'begränsad',
    residency: 'FR/EU',
    costSensitive: true,
    modelHint: 'Large eller Medium',
    icon: '🐍'
  },
  {
    id: 'image_generation',
    label: 'Image Generation',
    blurb:
      'Genererar bilder via FLUX 1.1 Pro Ultra (Black Forest Labs) genom ' +
      'Mistral. Genererat innehåll märks alltid som AI per art. 50.',
    riskClass: 'begränsad',
    residency: 'FR/EU',
    costSensitive: true,
    modelHint: 'Large eller Medium',
    icon: '🎨'
  },
  {
    id: 'document_library',
    label: 'Document Library',
    blurb:
      'Söker i dokumentbibliotek som finns uppladdade i Mistrals workspace. ' +
      'Avstängd by default — kräver att admin lägger till i tillåtna ' +
      'connectors (separat DPIA om vi laddar upp bolagsdata).',
    riskClass: 'begränsad',
    residency: 'FR/EU',
    costSensitive: true,
    modelHint: 'Large eller Medium',
    icon: '📚'
  }
];

const INDEX = new Map<BuiltinId, BuiltinMeta>(BUILTINS.map((b) => [b.id, b]));

export function getBuiltin(id: string): BuiltinMeta | undefined {
  return INDEX.get(id as BuiltinId);
}

export function isBuiltinId(id: string): id is BuiltinId {
  return INDEX.has(id as BuiltinId);
}

// Default-tillåtna built-ins när tenanten inte har en explicit allowlist.
// CLAUDE.md § 10.1 kostnadskontroll: kostnadsdrivande connectors måste
// explicit aktiveras av admin.
export const DEFAULT_ALLOWED_BUILTINS: BuiltinId[] = ['web_search'];

export function isConnectorAllowedForTenant(
  connectorKind: 'builtin' | 'mcp',
  connectorId: string,
  tenantAllowlist: string[] | null | undefined,
  options: { isStaff?: boolean } = {}
): boolean {
  // MCP-connectors är alltid tillåtna om de finns i workspacet — vi kan
  // inte påtvinga policys på custom MCPs här. Admin styr via Mistral-
  // workspacet vilka MCPs som är aktiva.
  if (connectorKind === 'mcp') return true;

  // Staff får testa alla built-ins även när allowlistan inte är satt.
  if (options.isStaff) return true;

  if (Array.isArray(tenantAllowlist) && tenantAllowlist.length > 0) {
    return tenantAllowlist.includes(connectorId);
  }
  // Ingen explicit allowlist → fall tillbaka till defaults.
  return (DEFAULT_ALLOWED_BUILTINS as string[]).includes(connectorId);
}
