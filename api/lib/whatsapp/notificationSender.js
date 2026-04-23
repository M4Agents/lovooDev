// =============================================================
// NOTIFICATION SENDER — envio WhatsApp para notificações Lovoo
//
// Responsabilidade:
//   - Enviar mensagem de texto diretamente a um número via Uazapi
//   - Não criar conversas no CRM
//   - Não salvar mensagens no banco
//   - Ser usado exclusivamente por crons de notificação (ex: trial alerts)
//
// Diferença em relação a api/lib/automation/whatsappSender.js:
//   - Sem resolução de lead, conversa ou userId
//   - Sem acesso ao banco
//   - Sem criação de chat_messages
//   - Entrada direta: number (E.164) + message + instance.provider_token
//
// Referências de implementação confirmadas:
//   - Endpoint Uazapi: https://lovoo.uazapi.com/send/text
//   - Header de autenticação: { token: provider_token }
//   - Campo de telefone na tabela companies: "telefone_principal"
//   - normalizeToE164() implementada em api/lib/notifications/variablesResolver.js
// =============================================================

const UAZAPI_BASE    = 'https://lovoo.uazapi.com'
const UAZAPI_TIMEOUT = 15_000 // 15 segundos — timeout conservador para HTTP

// ---------------------------------------------------------------------------
// Validações internas
// ---------------------------------------------------------------------------

/**
 * Valida se o número está em formato E.164 (ex: +5511999999999).
 * Aceita '+' seguido de 10 a 15 dígitos.
 */
function isValidE164(number) {
  return typeof number === 'string' && /^\+\d{10,15}$/.test(number)
}

// ---------------------------------------------------------------------------
// sendWhatsApp — função pública de envio
// ---------------------------------------------------------------------------

/**
 * Envia uma mensagem de texto WhatsApp via Uazapi.
 *
 * O número deve estar normalizado em E.164 antes desta chamada.
 * Use normalizeToE164() de api/lib/notifications/variablesResolver.js
 * para converter o campo telefone_principal da empresa.
 *
 * @param {object} params
 * @param {string} params.number   - Número destinatário em formato E.164 (ex: +5511999999999)
 * @param {string} params.message  - Texto da mensagem (variáveis já resolvidas)
 * @param {object} params.instance - Objeto de instância com provider_token
 * @param {string} params.instance.provider_token - Token de autenticação da instância Uazapi
 *
 * @returns {Promise<{ success: true, messageId: string|null }>}
 * @throws  {Error} Se validação falhar ou envio retornar erro
 */
export async function sendWhatsApp({ number, message, instance }) {
  // ── Validações de entrada ────────────────────────────────────────────────

  if (!number || !isValidE164(number)) {
    throw new Error(
      `[notificationSender] Número inválido ou ausente: "${number}". ` +
      'Esperado formato E.164, ex: +5511999999999'
    )
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('[notificationSender] Mensagem ausente ou vazia')
  }

  if (!instance?.provider_token || typeof instance.provider_token !== 'string') {
    throw new Error(
      '[notificationSender] provider_token da instância ausente ou inválido'
    )
  }

  // ── Chamada HTTP para Uazapi ─────────────────────────────────────────────

  const url     = `${UAZAPI_BASE}/send/text`
  const payload = {
    number,
    text:  message.trim(),
    delay: 1000,
  }

  let response
  try {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), UAZAPI_TIMEOUT)

    response = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        token: instance.provider_token,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        `[notificationSender] Timeout ao enviar WhatsApp para ${number} (limite: ${UAZAPI_TIMEOUT}ms)`
      )
    }
    throw new Error(
      `[notificationSender] Erro de rede ao chamar Uazapi: ${err?.message ?? String(err)}`
    )
  }

  // ── Leitura da resposta ──────────────────────────────────────────────────

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(
      `[notificationSender] Resposta inesperada da Uazapi (HTTP ${response.status}): não foi possível parsear JSON`
    )
  }

  if (!response.ok) {
    const detail = result?.error || result?.message || JSON.stringify(result)
    throw new Error(
      `[notificationSender] Uazapi retornou HTTP ${response.status} para ${number}: ${detail}`
    )
  }

  // Uazapi retorna o id da mensagem enviada em diferentes campos dependendo da versão
  const messageId = result?.messageid ?? result?.messageId ?? null

  return { success: true, messageId }
}
