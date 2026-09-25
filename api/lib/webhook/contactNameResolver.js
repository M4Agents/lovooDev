/**
 * contactNameResolver.js
 *
 * Helpers para resolução e validação de nomes de contato vindos
 * do webhook uazapi. Extraídos para permitir testes unitários.
 *
 * Regras de segurança:
 *   - Nunca loga nome, telefone, token ou resposta completa da API.
 *   - clearTimeout garantido em finally em qualquer caminho de execução.
 *   - Timeout 2s: falha nunca bloqueia o processamento da mensagem.
 */

/**
 * true se o nome é um placeholder gerado pelo sistema.
 * Rejeita: null, "", ".", "Lead WhatsApp", "Contato 5582996..."
 */
export function isPlaceholderName(name) {
  if (!name) return true;
  const t = name.trim();
  return (
    t === '' ||
    t === '.' ||
    t === 'Lead WhatsApp' ||
    /^Contato \d+$/.test(t)
  );
}

/**
 * true se a string contém ao menos uma letra Unicode.
 */
export function isValidContactName(str) {
  return /\p{L}/u.test((str || '').trim());
}

/**
 * Consulta a API uazapi para obter o nome do contato.
 * Chamada aguardada, timeout 2s — falha nunca impede o processamento.
 *
 * Contrato com a API (confirmado via `Object.keys(data?.data || {})`):
 *   POST https://api.uazapi.com/chat/GetNameAndImageURL/{instanceName}
 *   header: apikey: <token>
 *   body:   { phone: <phoneNumber> }
 *   candidatos lidos: data?.data?.name ?? data?.name
 *
 * ⚠  O log de diagnóstico abaixo deve ser removido após validação
 *    em produção com contato de nome conhecido.
 *
 * @param {{ token: string, instanceName: string, phoneNumber: string }} params
 * @returns {Promise<string|null>} nome real ou null
 */
export async function fetchContactNameFromUazapi({ token, instanceName, phoneNumber }) {
  if (!token || !instanceName || !phoneNumber) return null;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(
      `https://api.uazapi.com/chat/GetNameAndImageURL/${instanceName}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', apikey: token },
        body:    JSON.stringify({ phone: phoneNumber }),
        signal:  controller.signal,
      }
    );

    if (!res.ok) {
      console.warn('[fetchContactName] HTTP', res.status);
      return null;
    }

    const data = await res.json();

    // Diagnóstico de estrutura — remover após validação com contato conhecido
    console.log('[fetchContactName] campos em data.data:', Object.keys(data?.data || {}));

    const candidate = data?.data?.name ?? data?.name ?? null;

    if (!candidate || typeof candidate !== 'string') return null;
    const trimmed = candidate.trim();
    if (isPlaceholderName(trimmed)) return null;
    if (!isValidContactName(trimmed)) return null;
    return trimmed;

  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout_2s' : err.message;
    console.warn('[fetchContactName] falhou:', reason);
    return null;
  } finally {
    clearTimeout(tid);
  }
}
