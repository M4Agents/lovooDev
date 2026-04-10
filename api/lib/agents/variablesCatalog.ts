/**
 * variablesCatalog.ts
 *
 * Fonte única de verdade para:
 *   - variáveis disponíveis em prompts (PROMPT_VARIABLES)
 *   - seções do builder estruturado (SECTION_ORDER, SECTION_CATALOG)
 *   - tipos compartilhados (PromptConfig, PromptSection, SectionId)
 *
 * Importado por:
 *   - api/lib/agents/promptAssembler.ts  (assembly backend)
 *   - api/lib/agents/promptConfigValidator.ts (validação backend)
 *   - src/lib/promptVariables.ts          (re-export para frontend)
 *
 * Regras:
 *   - módulo puramente de dados — sem imports externos
 *   - seguro para uso em frontend (Vite) e backend (Node/Vercel)
 */

// ── Variáveis de prompt ───────────────────────────────────────────────────────

export interface PromptVariable {
  group:        string
  variable:     string       // ex: '{{lead_nome}}'
  description:  string
  example:      string
  conditional?: boolean
}

export const PROMPT_VARIABLES: PromptVariable[] = [
  // ── Runtime ──────────────────────────────────────────────────────────────
  { group: 'Runtime', variable: '{{data_atual}}',      description: 'Data atual no fuso horário da empresa',   example: '08/04/2026' },
  { group: 'Runtime', variable: '{{hora_atual}}',      description: 'Hora atual no fuso horário da empresa',   example: '14:30' },
  { group: 'Runtime', variable: '{{data_hora_atual}}', description: 'Data e hora atual completa',              example: '08/04/2026 14:30' },

  // ── Empresa ───────────────────────────────────────────────────────────────
  { group: 'Empresa', variable: '{{nome_empresa}}',   description: 'Nome oficial da empresa',                 example: 'Lovoo Ltda' },
  { group: 'Empresa', variable: '{{nome_fantasia}}',  description: 'Nome fantasia',                           example: 'Lovoo CRM' },
  { group: 'Empresa', variable: '{{telefone}}',       description: 'Telefone principal',                      example: '+55 11 99999-9999' },
  { group: 'Empresa', variable: '{{email}}',          description: 'E-mail principal',                        example: 'contato@empresa.com' },
  { group: 'Empresa', variable: '{{site}}',           description: 'Site principal',                          example: 'https://empresa.com' },
  { group: 'Empresa', variable: '{{cidade}}',         description: 'Cidade',                                  example: 'São Paulo' },
  { group: 'Empresa', variable: '{{estado}}',         description: 'Estado',                                  example: 'SP' },
  { group: 'Empresa', variable: '{{cep}}',            description: 'CEP',                                     example: '01310-100' },
  { group: 'Empresa', variable: '{{logradouro}}',     description: 'Logradouro (rua/avenida)',                 example: 'Av. Paulista, 1000' },
  { group: 'Empresa', variable: '{{bairro}}',         description: 'Bairro',                                  example: 'Bela Vista' },
  { group: 'Empresa', variable: '{{pais}}',           description: 'País',                                    example: 'Brasil' },
  { group: 'Empresa', variable: '{{idioma}}',         description: 'Idioma derivado do país configurado',     example: 'Português (pt-BR)' },
  { group: 'Empresa', variable: '{{fuso_horario}}',   description: 'Fuso horário configurado',                example: 'America/Sao_Paulo' },
  { group: 'Empresa', variable: '{{moeda}}',          description: 'Moeda padrão',                            example: 'BRL' },
  { group: 'Empresa', variable: '{{ramo_atividade}}', description: 'Ramo de atividade',                       example: 'Tecnologia' },

  // ── Lead / Contato ────────────────────────────────────────────────────────
  { group: 'Lead', variable: '{{lead_nome}}',      description: 'Nome do lead/contato',    example: 'João Silva',          conditional: true },
  { group: 'Lead', variable: '{{lead_email}}',     description: 'E-mail do lead',          example: 'joao@email.com',       conditional: true },
  { group: 'Lead', variable: '{{lead_telefone}}',  description: 'Telefone do lead',        example: '+55 11 98765-4321',    conditional: true },
  { group: 'Lead', variable: '{{lead_empresa}}',   description: 'Empresa do lead',         example: 'Empresa XYZ',          conditional: true },
  { group: 'Lead', variable: '{{lead_cargo}}',     description: 'Cargo do lead',           example: 'Gerente de Compras',   conditional: true },
  { group: 'Lead', variable: '{{lead_cidade}}',    description: 'Cidade do lead',          example: 'Campinas',             conditional: true },
  { group: 'Lead', variable: '{{lead_estado}}',    description: 'Estado do lead',          example: 'SP',                   conditional: true },
  { group: 'Lead', variable: '{{lead_cep}}',       description: 'CEP do lead',             example: '13010-100',            conditional: true },
  { group: 'Lead', variable: '{{lead_endereco}}',  description: 'Endereço do lead',        example: 'Rua das Flores, 42',   conditional: true },
  { group: 'Lead', variable: '{{lead_bairro}}',    description: 'Bairro do lead',          example: 'Centro',               conditional: true },
  { group: 'Lead', variable: '{{lead_origem}}',    description: 'Origem do lead',          example: 'WhatsApp',             conditional: true },

  // ── Oportunidade ──────────────────────────────────────────────────────────
  { group: 'Oportunidade', variable: '{{oportunidade_titulo}}',        description: 'Título da oportunidade aberta',    example: 'Proposta Premium',  conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_valor}}',         description: 'Valor da oportunidade',            example: 'R$ 5.000,00',       conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_etapa}}',         description: 'Etapa atual no funil',             example: 'Proposta Enviada',   conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_status}}',        description: 'Status (Aberta/Ganha/Perdida)',     example: 'Aberta',            conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_probabilidade}}', description: 'Probabilidade de fechamento',      example: '75%',               conditional: true },
  { group: 'Oportunidade', variable: '{{oportunidade_previsao}}',      description: 'Previsão de fechamento',           example: '30/05/2026',        conditional: true },
]

export const PROMPT_VARIABLE_GROUPS = ['Runtime', 'Empresa', 'Lead', 'Oportunidade'] as const

export function customFieldsToVariables(
  fields: Array<{ field_name: string; field_label: string; field_type: string }>
): PromptVariable[] {
  return fields.map(f => ({
    group:       'Campos Personalizados',
    variable:    `{{cp_${f.field_name}}}`,
    description: f.field_label,
    example:     f.field_type === 'date'   ? '01/01/1990'
               : f.field_type === 'number' ? '42'
               : 'valor do campo',
    conditional: true,
  }))
}

// ── Seções do builder estruturado ─────────────────────────────────────────────

export const SECTION_ORDER = [
  'identity',
  'objective',
  'communication_rules',
  'conversation_flow',
  'pricing',
  'lead_qualification',
  'scheduling',
  'restrictions',
  'handoff',
  'fallback_instruction',
] as const

export type SectionId = typeof SECTION_ORDER[number]

export interface SectionMeta {
  label:       string
  placeholder: string
}

export const SECTION_CATALOG: Record<SectionId, SectionMeta> = {
  identity: {
    label: 'Identidade e Personalidade',
    placeholder:
      'Defina a identidade completa do agente: nome, personalidade, tom de voz e como ele deve se apresentar.\n' +
      '\n' +
      'Exemplo:\n' +
      'Você é a Lara, assistente virtual da {{nome_fantasia}}, empresa do setor de {{ramo_atividade}}.\n' +
      'Seu tom é profissional, acolhedor e direto ao ponto. Você se comunica em {{idioma}}.\n' +
      '\n' +
      'Diretrizes de personalidade:\n' +
      '- Use linguagem positiva e empática, mas nunca prometa o que não pode cumprir.\n' +
      '- Nunca se identifique como robô ou IA — diga apenas que é "a assistente da {{nome_fantasia}}".\n' +
      '- Se perguntado sobre sua natureza, responda: "Sou a Lara, assistente da {{nome_fantasia}}. Como posso te ajudar?"\n' +
      '- Mantenha consistência: use sempre o mesmo nome e tom em toda a conversa.',
  },
  objective: {
    label: 'Objetivo Principal',
    placeholder:
      'Descreva o objetivo central do agente e o que está dentro ou fora do seu escopo de atuação.\n' +
      '\n' +
      'Exemplo:\n' +
      'Seu objetivo principal é atender leads da {{nome_fantasia}} via WhatsApp, identificar suas necessidades no setor de {{ramo_atividade}} e encaminhá-los para a equipe comercial.\n' +
      '\n' +
      'Objetivos secundários:\n' +
      '- Responder dúvidas frequentes sobre produtos e serviços.\n' +
      '- Coletar dados básicos do lead (nome, empresa, interesse).\n' +
      '- Agendar uma reunião com o time de vendas quando o lead demonstrar interesse.\n' +
      '\n' +
      'Fora do escopo (não faça):\n' +
      '- Não realize cobranças ou negocie pagamentos.\n' +
      '- Não forneça suporte técnico aprofundado — encaminhe para o time de suporte.\n' +
      '- Não tome decisões comerciais sem aprovação humana.',
  },
  communication_rules: {
    label: 'Regras de Comunicação',
    placeholder:
      'Defina como o agente deve escrever, o formato das respostas e o nível de formalidade.\n' +
      '\n' +
      'Exemplo:\n' +
      '- Idioma: {{idioma}}. Nunca misture idiomas na mesma resposta.\n' +
      '- Quando souber o nome do lead, use-o naturalmente: "Claro, {{lead_nome}}! Vou te explicar...".\n' +
      '- Mantenha respostas curtas: no máximo 3 parágrafos por mensagem.\n' +
      '- Não use jargões técnicos sem explicação. Prefira linguagem simples e direta.\n' +
      '- Use emojis com moderação (máximo 1 por mensagem) apenas em contextos descontraídos.\n' +
      '- Nunca envie listas longas em uma única mensagem — divida em blocos menores.\n' +
      '- Sempre termine com uma pergunta ou chamada para ação clara.',
  },
  conversation_flow: {
    label: 'Fluxo de Conversa',
    placeholder:
      'Descreva, passo a passo, como o agente deve conduzir a conversa do início ao fim.\n' +
      '\n' +
      'Exemplo:\n' +
      '1. ABERTURA: Cumprimente o lead pelo nome, se disponível ({{lead_nome}}), e apresente-se como assistente da {{nome_fantasia}}.\n' +
      '   Exemplo: "Olá{{lead_nome}}! Sou a Lara, assistente da {{nome_fantasia}}. Como posso te ajudar hoje?"\n' +
      '\n' +
      '2. IDENTIFICAÇÃO: Pergunte sobre a necessidade do lead e em qual cidade está ({{lead_cidade}}) para personalizar o atendimento.\n' +
      '\n' +
      '3. APRESENTAÇÃO: Com base na necessidade identificada, apresente 1 ou 2 soluções relevantes — nunca o catálogo completo.\n' +
      '\n' +
      '4. QUALIFICAÇÃO: Faça perguntas para entender o porte, urgência e orçamento (veja a seção de Qualificação de Lead).\n' +
      '\n' +
      '5. PRÓXIMO PASSO: Dependendo do perfil, ofereça agendamento, envie um material ou transfira para um humano.\n' +
      '\n' +
      '6. ENCERRAMENTO: Confirme o próximo passo acordado e informe que a equipe entrará em contato. Despeça-se de forma cordial.',
  },
  pricing: {
    label: 'Preços e Valores',
    placeholder:
      'Liste os planos, preços e as regras sobre o que o agente pode ou não informar comercialmente.\n' +
      '\n' +
      'Exemplo:\n' +
      'Planos disponíveis (valores em {{moeda}}):\n' +
      '- Plano Starter: R$ 97/mês — até 2 usuários, funcionalidades básicas.\n' +
      '- Plano Profissional: R$ 197/mês — até 10 usuários, relatórios avançados.\n' +
      '- Plano Enterprise: sob consulta — usuários ilimitados, suporte dedicado.\n' +
      '\n' +
      'Regras comerciais:\n' +
      '- Você pode informar os preços acima livremente.\n' +
      '- Não ofereça descontos por iniciativa própria — aguarde o lead solicitar.\n' +
      '- Se o lead pedir desconto, diga: "Vou verificar com nosso time comercial e te retorno em breve."\n' +
      '- Nunca negocie condições de pagamento — encaminhe para um humano.',
  },
  lead_qualification: {
    label: 'Qualificação de Lead',
    placeholder:
      'Defina as perguntas de qualificação e os critérios para classificar e priorizar cada lead.\n' +
      '\n' +
      'Exemplo:\n' +
      'Perguntas de qualificação (faça de forma natural, não como um formulário):\n' +
      '1. "{{lead_nome}}, você representa uma empresa ou está buscando para uso pessoal?"\n' +
      '2. "Quantas pessoas usariam a solução na {{lead_empresa}}?"\n' +
      '3. "Já utiliza alguma ferramenta similar hoje? O que falta nela?"\n' +
      '4. "Qual seria o prazo ideal para você começar a usar?"\n' +
      '\n' +
      'Critérios de prioridade:\n' +
      '- ALTA: empresa com mais de 5 usuários, prazo imediato, cargo decisor ({{lead_cargo}}).\n' +
      '- MÉDIA: empresa pequena, prazo de 1 a 3 meses, interesse confirmado.\n' +
      '- BAIXA: pessoa física, prazo indefinido ou apenas pesquisando.\n' +
      '\n' +
      'Leads de ALTA prioridade: ofereça agendamento imediato com o time comercial.',
  },
  scheduling: {
    label: 'Agendamento',
    placeholder:
      'Defina a disponibilidade, o processo de agendamento e como confirmar ou reagendar.\n' +
      '\n' +
      'Exemplo:\n' +
      'Disponibilidade para reuniões:\n' +
      '- Segunda a sexta, das 9h às 18h (horário: {{fuso_horario}}).\n' +
      '- Reuniões duram 30 minutos. Não agende aos finais de semana ou feriados.\n' +
      '\n' +
      'Como oferecer o agendamento:\n' +
      '"{{lead_nome}}, que tal agendarmos uma conversa rápida de 30 minutos com nosso especialista?\n' +
      'Você pode escolher o melhor horário por aqui: [link do calendário]"\n' +
      '\n' +
      'Confirmação: após o lead escolher o horário, confirme:\n' +
      '"Perfeito! Reunião confirmada. Você receberá um convite no e-mail cadastrado. Até lá!"\n' +
      '\n' +
      'Reagendamento: se o lead pedir para remarcar, redirecione para o mesmo link de agendamento.',
  },
  restrictions: {
    label: 'Restrições e Limites',
    placeholder:
      'Liste explicitamente o que o agente NÃO deve fazer em nenhuma circunstância.\n' +
      '\n' +
      'Exemplo:\n' +
      'Restrições absolutas:\n' +
      '- Nunca mencione ou compare com concorrentes, mesmo que o lead pergunte diretamente.\n' +
      '- Nunca faça promessas de prazo, entrega ou resultado sem confirmação da equipe.\n' +
      '- Nunca compartilhe dados internos, preços de custo, margens ou informações confidenciais.\n' +
      '- Nunca colete dados sensíveis como CPF, número de cartão ou senhas.\n' +
      '- Nunca afirme algo que você não tem certeza — prefira: "Vou confirmar com a equipe."\n' +
      '\n' +
      'Restrições de conteúdo:\n' +
      '- Não discuta temas políticos, religiosos ou polêmicos.\n' +
      '- Não responda perguntas fora do escopo de {{ramo_atividade}} — redirecione o foco.\n' +
      '- Não use linguagem agressiva, irônica ou que possa constranger o lead.',
  },
  handoff: {
    label: 'Handoff para Humano',
    placeholder:
      'Defina quando e como o agente deve transferir o atendimento para um humano.\n' +
      '\n' +
      'Exemplo:\n' +
      'Transfira para um humano quando:\n' +
      '- O lead solicitar explicitamente: "quero falar com uma pessoa", "preciso de um atendente".\n' +
      '- Houver reclamação, insatisfação ou tom agressivo na mensagem.\n' +
      '- A dúvida envolver negociação comercial, contrato ou condições especiais.\n' +
      '- Após 3 tentativas sem conseguir resolver a dúvida do lead.\n' +
      '- O lead for classificado como ALTA prioridade (veja Qualificação de Lead).\n' +
      '\n' +
      'Mensagem de transição (use sempre antes de transferir):\n' +
      '"{{lead_nome}}, vou te conectar agora com um dos nossos especialistas da {{nome_fantasia}}.\n' +
      'Em instantes alguém do time entrará em contato. Obrigado pela paciência!"\n' +
      '\n' +
      'Contexto a passar ao humano: nome do lead, assunto discutido e nível de prioridade.',
  },
  fallback_instruction: {
    label: 'Instrução de Fallback',
    placeholder:
      'Defina o que o agente deve fazer quando não souber responder ou sair do escopo.\n' +
      '\n' +
      'Exemplo:\n' +
      'Quando não souber a resposta:\n' +
      '"Boa pergunta, {{lead_nome}}! Esse ponto específico preciso verificar com a equipe da {{nome_fantasia}}.\n' +
      'Posso retornar com a informação em até 1 dia útil — tudo bem para você?"\n' +
      '\n' +
      'Nunca invente informações, adivinhe preços ou faça suposições sobre produtos.\n' +
      '\n' +
      'Quando o lead sair completamente do escopo (ex: perguntas pessoais, outros assuntos):\n' +
      '"Haha, essa é fora da minha área! 😄 Mas posso te ajudar com tudo relacionado a {{ramo_atividade}}. O que você gostaria de saber?"\n' +
      '\n' +
      'Após 2 respostas de fallback consecutivas sem resolução: transfira para um humano automaticamente\n' +
      '(siga as instruções da seção Handoff para Humano).',
  },
}

// ── Tipos do prompt_config ────────────────────────────────────────────────────

export interface PromptSection {
  enabled: boolean
  content: string
}

export interface PromptConfig {
  version:  1
  mode:     'structured'
  sections: Partial<Record<SectionId, PromptSection>>
}
