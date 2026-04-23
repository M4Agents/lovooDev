// =============================================================
// RESEND CLIENT — infraestrutura de email do sistema Lovoo CRM
//
// Responsabilidade:
//   - Encapsular o SDK do Resend
//   - Validar variáveis de ambiente obrigatórias na inicialização
//   - Expor sendEmail({ to, subject, html }) como API pública
//   - Retornar dados úteis do provider (id do email enviado)
//
// Sem acesso ao banco. Sem side effects além do envio.
// =============================================================

import { Resend } from 'resend'

// ---------------------------------------------------------------------------
// Validação de ambiente e instância do cliente
// ---------------------------------------------------------------------------

function getRequiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[resendClient] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

/**
 * Cria e retorna uma instância validada do cliente Resend.
 * A validação ocorre no momento da chamada, não no import,
 * para suportar hot reload e ambientes de teste.
 */
function buildClient() {
  const apiKey = getRequiredEnv('RESEND_API_KEY')
  return new Resend(apiKey)
}

// ---------------------------------------------------------------------------
// sendEmail — função pública de envio
// ---------------------------------------------------------------------------

/**
 * Envia um email via Resend.
 *
 * @param {object} params
 * @param {string|string[]} params.to      - Destinatário(s)
 * @param {string}          params.subject - Assunto do email
 * @param {string}          params.html    - Corpo HTML completo
 *
 * @returns {Promise<{ id: string }>} Dados retornados pelo Resend
 * @throws  {Error} Se env vars estiverem ausentes ou o envio falhar
 */
export async function sendEmail({ to, subject, html }) {
  if (!to || !subject || !html) {
    throw new Error('[resendClient] Parâmetros obrigatórios ausentes: to, subject, html')
  }

  const from = getRequiredEnv('EMAIL_FROM')
  const client = buildClient()

  const { data, error } = await client.emails.send({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  })

  if (error) {
    throw new Error(`[resendClient] Falha ao enviar email: ${error.message ?? JSON.stringify(error)}`)
  }

  return { id: data.id }
}
