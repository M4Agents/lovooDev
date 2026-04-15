/**
 * Enum oficial de valores de `source` para o gatilho Lead Criado.
 *
 * Deve permanecer em sincronia com os dispatchers backend:
 *   - manual   → api.ts createLead  (source: 'manual')
 *   - whatsapp → uazapi handlers    (source: 'whatsapp')
 *   - import   → api.ts importLeads (source: 'import')
 *   - api      → api/leads/create.js (source: 'api')
 *   - webhook  → webhook-lead.js, webhook/lead/[api_key].js (source: 'webhook')
 *
 * 'any' é o valor persistido para "Qualquer origem" (sem filtro).
 * O triggerEvaluator trata 'any' como "match all".
 */
export const LEAD_SOURCE_ANY = 'any'

export const LEAD_SOURCE_OPTIONS = [
  { value: 'any',      label: 'Qualquer origem'      },
  { value: 'manual',   label: 'Manual'               },
  { value: 'whatsapp', label: 'WhatsApp'             },
  { value: 'import',   label: 'Importação em massa'  },
  { value: 'api',      label: 'Via API interna'      },
  { value: 'webhook',  label: 'Via Webhook externo'  },
] as const

export type LeadSource = typeof LEAD_SOURCE_OPTIONS[number]['value']
