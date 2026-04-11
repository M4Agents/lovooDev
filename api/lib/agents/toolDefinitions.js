// =============================================================================
// api/lib/agents/toolDefinitions.js
//
// Catálogo de tools disponíveis para function calling OpenAI.
//
// IMPORTANTE:
//   - Nunca incluir company_id, lead_id, opportunity_id nos parâmetros das tools.
//     Esses IDs vêm do contexto autenticado do backend, nunca do LLM.
//   - O campo `description` é parte do prompt para o LLM — seja preciso e claro.
//   - Cada tool tem metadata extra (isCritical, allowedForAgentTypes) para o
//     toolExecutor e runner usarem sem precisar de lógica inline.
//
// ALLOWLIST:
//   O runner filtra as tools declaradas para o OpenAI usando agent.allowed_tools.
//   O toolExecutor valida novamente antes de executar (defesa em profundidade).
// =============================================================================

/** @type {import('openai').ChatCompletionTool[]} */
export const ALL_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'update_lead',
      description:
        'Atualiza dados cadastrais do lead na conversa. '
        + 'Use apenas para campos que o lead explicitamente informou ou confirmou. '
        + 'Nunca inferir dados não confirmados.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description:
              'Campos a atualizar. Apenas campos permitidos: '
              + 'name, email, phone, company_name, cargo, notes. '
              + 'Inclua somente os campos que realmente mudaram.',
            properties: {
              name:         { type: 'string', description: 'Nome completo do lead' },
              email:        { type: 'string', description: 'Email do lead' },
              phone:        { type: 'string', description: 'Telefone com DDD' },
              company_name: { type: 'string', description: 'Empresa do lead' },
              cargo:        { type: 'string', description: 'Cargo ou função' },
              notes:        { type: 'string', description: 'Observações gerais sobre o lead' },
            },
            additionalProperties: false,
          },
        },
        required: ['fields'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'add_tag',
      description:
        'Adiciona uma tag ao lead. Use para marcar intenção, interesse ou status de qualificação. '
        + 'Ex: "qualificado", "interesse-agendamento", "sem-interesse".',
      parameters: {
        type: 'object',
        properties: {
          tag_name: {
            type: 'string',
            description: 'Nome exato da tag a adicionar. Máximo 50 caracteres.',
            maxLength: 50,
          },
        },
        required: ['tag_name'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'remove_tag',
      description: 'Remove uma tag existente do lead.',
      parameters: {
        type: 'object',
        properties: {
          tag_name: {
            type: 'string',
            description: 'Nome exato da tag a remover.',
            maxLength: 50,
          },
        },
        required: ['tag_name'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'create_activity',
      description:
        'Cria uma atividade ou agendamento no CRM para este lead. '
        + 'Use quando o lead confirmar uma reunião, ligação ou compromisso. '
        + 'A data e hora devem ser confirmadas explicitamente pelo lead.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Título da atividade. Ex: "Reunião de apresentação", "Ligação de retorno"',
            maxLength: 120,
          },
          activity_type: {
            type: 'string',
            enum: ['call', 'meeting', 'follow_up', 'task', 'email'],
            description: 'Tipo de atividade',
          },
          scheduled_date: {
            type: 'string',
            description: 'Data no formato YYYY-MM-DD. Ex: "2026-04-15"',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
          scheduled_time: {
            type: 'string',
            description: 'Hora no formato HH:MM. Ex: "10:00"',
            pattern: '^\\d{2}:\\d{2}$',
          },
          description: {
            type: 'string',
            description: 'Detalhes adicionais sobre a atividade (opcional)',
            maxLength: 500,
          },
        },
        required: ['title', 'activity_type', 'scheduled_date', 'scheduled_time'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'add_note',
      description:
        'Adiciona uma nota interna ao lead ou à oportunidade ativa. '
        + 'Use para registrar informações relevantes da conversa que não se encaixam em campos estruturados.',
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            enum: ['lead', 'opportunity'],
            description: 'Onde registrar a nota: no lead ou na oportunidade ativa',
          },
          text: {
            type: 'string',
            description: 'Conteúdo da nota. Seja objetivo e factual.',
            maxLength: 1000,
          },
        },
        required: ['entity', 'text'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'move_opportunity',
      description:
        'Move o card da oportunidade ativa para outra etapa do funil. '
        + 'Use apenas quando o lead avançar claramente no processo de venda.',
      parameters: {
        type: 'object',
        properties: {
          stage_id: {
            type: 'string',
            description: 'UUID da etapa de destino no funil',
            format: 'uuid',
          },
          reason: {
            type: 'string',
            description: 'Motivo da movimentação (para registro interno)',
            maxLength: 200,
          },
        },
        required: ['stage_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'update_opportunity',
      description:
        'Atualiza dados da oportunidade ativa (valor, probabilidade, previsão de fechamento). '
        + 'Use quando o lead confirmar informações comerciais.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description: 'Campos a atualizar',
            properties: {
              value:               { type: 'number',  description: 'Valor da oportunidade' },
              probability:         { type: 'integer', description: 'Probabilidade de fechamento (0-100)', minimum: 0, maximum: 100 },
              expected_close_date: { type: 'string',  description: 'Previsão de fechamento YYYY-MM-DD', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              title:               { type: 'string',  description: 'Título da oportunidade', maxLength: 200 },
            },
            additionalProperties: false,
          },
        },
        required: ['fields'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'schedule_contact',
      description:
        'Agenda um retorno de contato futuro. Use quando o lead pedir para ser contatado '
        + 'em outra data/hora, ou para programar um follow-up automático.',
      parameters: {
        type: 'object',
        properties: {
          scheduled_at: {
            type: 'string',
            description: 'Data e hora do contato em formato ISO 8601. Ex: "2026-04-17T10:00:00"',
          },
          reason: {
            type: 'string',
            enum: ['contact_later', 'follow_up', 'retry', 'reengagement'],
            description: 'Motivo do agendamento',
          },
          message_hint: {
            type: 'string',
            description: 'Contexto para o agente que fará o contato (ex: "lead pediu info sobre plano premium")',
            maxLength: 300,
          },
        },
        required: ['scheduled_at', 'reason'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'request_handoff',
      description:
        'Solicita transferência da conversa para um atendente humano. '
        + 'Use quando o lead pedir explicitamente falar com humano, '
        + 'quando a situação for muito complexa ou sensível, '
        + 'ou quando você não conseguir ajudar adequadamente.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Motivo da transferência para registro interno',
            maxLength: 300,
          },
        },
        required: ['reason'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'send_media',
      description: 'Envia mídias relacionadas ao contexto atual',
      parameters: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            enum: ['presentation', 'proof', 'detail'],
            description:
              'Intenção do envio: apresentação, prova social ou detalhamento (material de apoio).',
          },
        },
        required: ['intent'],
      },
    },
  },
]

/**
 * Retorna apenas as definições das tools que estão na allowlist do agente.
 * Se allowedTools estiver vazio, retorna array vazio (agente sem tools).
 *
 * @param {string[]} allowedTools - Lista de nomes de tools permitidas (de lovoo_agents.allowed_tools)
 * @returns {import('openai').ChatCompletionTool[]}
 */
export function getToolsForAgent(allowedTools) {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) return []
  return ALL_TOOL_DEFINITIONS.filter(t => allowedTools.includes(t.function.name))
}

/**
 * Tools críticas: falha impacta o lead diretamente e deve ser refletida na resposta.
 * @type {Set<string>}
 */
export const CRITICAL_TOOLS = new Set([
  'create_activity',
  'move_opportunity',
  'request_handoff',
  'schedule_contact',
])

/**
 * Tools cujos argumentos podem conter campos de identificação indevidos.
 * O toolExecutor os remove antes de persistir no audit log.
 * @type {string[]}
 */
export const FORBIDDEN_ARG_FIELDS = ['company_id', 'lead_id', 'opportunity_id', 'conversation_id', 'user_id']
