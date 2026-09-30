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
 * Primeiro candidato que não é placeholder e contém letra.
 * Ordem dos argumentos = prioridade (docs uazapi: name > wa_name > wa_contactName).
 */
export function pickResolvedContactName(...candidates) {
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (isPlaceholderName(trimmed)) continue;
    if (!isValidContactName(trimmed)) continue;
    return trimmed;
  }
  return null;
}

/**
 * Consulta oficial POST /chat/details depois que o chat já existe no servidor.
 * Docs: https://docs.uazapi.com/reference/getChatDetails.md
 * Header: token. Não loga nome, telefone, token nem o body.
 */
export async function fetchContactNameFromChatDetails({ token, phoneNumber, baseUrl }) {
  if (!token || !phoneNumber) return null;

  const apiBase = (baseUrl || 'https://api.uazapi.com').replace(/\/$/, '');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(`${apiBase}/chat/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: phoneNumber, preview: true }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn('[fetchContactName] details HTTP', res.status);
      return null;
    }

    const data = await res.json();
    const chat = data?.data && typeof data.data === 'object' ? data.data : data;
    return pickResolvedContactName(
      chat?.name,
      chat?.wa_name,
      chat?.wa_contactName,
    );
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout_2s' : err.message;
    console.warn('[fetchContactName] details falhou:', reason);
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Consulta a API uazapi para obter o nome do contato.
 * Chamada aguardada, timeout 2s — falha nunca impede o processamento.
 *
 * Usa `baseUrl` do payload (ex: https://lovoo.uazapi.com) em vez de URL
 * hardcoded, para suportar instâncias em servidores próprios.
 *
 * Contrato com a API (confirmado via `Object.keys(data?.data || {})`):
 *   GET {baseUrl}/chat/GetNameAndImageURL/{instanceName}?phone={phone}
 *   header: apikey: <token>
 *   (POST retorna 405 em lovoo.uazapi.com — endpoint usa GET neste servidor)
 *   candidatos lidos: data?.data?.name ?? data?.name
 *
 * ⚠  O log de diagnóstico abaixo deve ser removido após validação
 *    em produção com contato de nome conhecido.
 *
 * @param {{ token: string, instanceName: string, phoneNumber: string, baseUrl?: string }} params
 * @returns {Promise<string|null>} nome real ou null
 */
export async function fetchContactNameFromUazapi({ token, instanceName, phoneNumber, baseUrl }) {
  if (!token || !instanceName || !phoneNumber) return null;

  // Usa baseUrl do payload; fallback para api.uazapi.com apenas se ausente
  const apiBase = (baseUrl || 'https://api.uazapi.com').replace(/\/$/, '');

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 2000);

  try {
    // Montar URL com phone como query param (GET) — lovoo.uazapi.com retorna 405 para POST
    const url = new URL(`${apiBase}/chat/GetNameAndImageURL/${instanceName}`);
    url.searchParams.set('phone', phoneNumber);

    const res = await fetch(url.toString(), {
      method:  'GET',
      headers: { 'Content-Type': 'application/json', apikey: token },
      signal:  controller.signal,
    });

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
