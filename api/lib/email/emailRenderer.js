// =============================================================
// EMAIL RENDERER — layout HTML padrão do Lovoo CRM
//
// Responsabilidade:
//   - Montar o HTML final de um email a partir de conteúdo variável
//   - Manter o layout fixo, com identidade visual do Lovoo
//   - Injetar: logo, título, corpo, botão CTA (opcional), rodapé
//
// Regras:
//   - Função pura — sem efeitos colaterais, sem acesso ao banco
//   - O `body` já vem com variáveis resolvidas pelo renderTemplate()
//   - Se LOVOO_EMAIL_LOGO_URL não existir, usa fallback textual
//   - CSS inline para compatibilidade máxima com clientes de email
// =============================================================

// ---------------------------------------------------------------------------
// Constantes visuais
// ---------------------------------------------------------------------------

const BRAND_COLOR       = '#0074d4'   // azul primário Lovoo
const BRAND_COLOR_DARK  = '#005bb5'   // hover do botão CTA
const TEXT_DARK         = '#1a1a2e'
const TEXT_MUTED        = '#6b7280'
const BG_PAGE           = '#f3f4f6'
const BG_CARD           = '#ffffff'
const FONT_STACK        = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Converte quebras de linha (`\n`) em `<br>` para preservar
 * a formatação do corpo do template no HTML.
 */
function nl2br(text) {
  return String(text ?? '').replace(/\n/g, '<br>')
}

/**
 * Retorna o bloco HTML do logo.
 * Se a URL estiver ausente, usa fallback textual estilizado.
 */
function buildLogoBlock(logoUrl) {
  if (logoUrl) {
    return `
      <img
        src="${logoUrl}"
        alt="Lovoo CRM"
        width="180"
        style="display:block; margin:0 auto; max-width:180px; height:auto; border:0;"
      />`
  }

  return `
    <span style="
      display:block;
      text-align:center;
      font-family:${FONT_STACK};
      font-size:22px;
      font-weight:700;
      color:${BRAND_COLOR};
      letter-spacing:-0.5px;
    ">[Lovoo CRM]</span>`
}

/**
 * Retorna o bloco HTML do botão CTA.
 * Retorna string vazia se ctaUrl não for fornecido.
 */
function buildCtaBlock(ctaUrl) {
  if (!ctaUrl) return ''

  return `
    <tr>
      <td align="center" style="padding:24px 40px 8px;">
        <a
          href="${ctaUrl}"
          target="_blank"
          rel="noopener noreferrer"
          style="
            display:inline-block;
            background-color:${BRAND_COLOR};
            color:#ffffff;
            font-family:${FONT_STACK};
            font-size:15px;
            font-weight:600;
            text-decoration:none;
            padding:12px 32px;
            border-radius:6px;
            letter-spacing:0.2px;
            mso-padding-alt:0;
          "
        >Acessar plataforma</a>
      </td>
    </tr>`
}

// ---------------------------------------------------------------------------
// renderEmail — função pública
// ---------------------------------------------------------------------------

/**
 * Monta o HTML completo do email no layout padrão do Lovoo.
 *
 * @param {object} params
 * @param {string} params.subject  - Assunto / título exibido no corpo
 * @param {string} params.body     - Corpo com variáveis já resolvidas
 * @param {string} [params.ctaUrl] - URL do botão de ação (opcional)
 * @param {string} [params.logoUrl]- URL pública do logo (opcional; usa fallback se ausente)
 *
 * @returns {string} HTML completo pronto para envio
 */
export function renderEmail({ subject, body, ctaUrl, logoUrl }) {
  const resolvedLogoUrl = logoUrl || process.env.LOVOO_EMAIL_LOGO_URL || null

  const logoBlock = buildLogoBlock(resolvedLogoUrl)
  const ctaBlock  = buildCtaBlock(ctaUrl)
  const bodyHtml  = nl2br(body)

  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${subject}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${BG_PAGE}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">

  <!-- Wrapper externo -->
  <table
    role="presentation"
    cellspacing="0"
    cellpadding="0"
    border="0"
    width="100%"
    style="background-color:${BG_PAGE}; min-height:100vh;"
  >
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card central (max 600px) -->
        <table
          role="presentation"
          cellspacing="0"
          cellpadding="0"
          border="0"
          width="600"
          style="max-width:600px; width:100%; background-color:${BG_CARD}; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);"
        >

          <!-- Cabeçalho com logo -->
          <tr>
            <td align="center" style="padding:36px 40px 28px; border-bottom:1px solid #e5e7eb;">
              ${logoBlock}
            </td>
          </tr>

          <!-- Título do email -->
          <tr>
            <td style="padding:32px 40px 0;">
              <h1 style="
                margin:0;
                font-family:${FONT_STACK};
                font-size:20px;
                font-weight:700;
                color:${TEXT_DARK};
                line-height:1.3;
              ">${subject}</h1>
            </td>
          </tr>

          <!-- Corpo do email -->
          <tr>
            <td style="padding:16px 40px 24px;">
              <p style="
                margin:0;
                font-family:${FONT_STACK};
                font-size:15px;
                line-height:1.7;
                color:${TEXT_DARK};
              ">${bodyHtml}</p>
            </td>
          </tr>

          <!-- Botão CTA (renderizado somente se ctaUrl existir) -->
          ${ctaBlock}

          <!-- Divisor -->
          <tr>
            <td style="padding:24px 40px 0;">
              <hr style="border:none; border-top:1px solid #e5e7eb; margin:0;" />
            </td>
          </tr>

          <!-- Rodapé padrão Lovoo -->
          <tr>
            <td align="center" style="padding:20px 40px 32px;">
              <p style="
                margin:0 0 6px;
                font-family:${FONT_STACK};
                font-size:12px;
                color:${TEXT_MUTED};
                line-height:1.5;
              ">Este é um email automático. Por favor, não responda a esta mensagem.</p>
              <p style="
                margin:0;
                font-family:${FONT_STACK};
                font-size:12px;
                color:${TEXT_MUTED};
                line-height:1.5;
              ">
                &copy; ${new Date().getFullYear()} Lovoo CRM. Todos os direitos reservados.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card central -->

      </td>
    </tr>
  </table>
  <!-- /Wrapper externo -->

</body>
</html>`
}
