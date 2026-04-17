// =============================================================================
// whatsappParser.js
//
// Parser de arquivos .txt exportados do WhatsApp.
// Suporta formato Android e iOS.
// Aplica anonimização antes de retornar os turnos.
// =============================================================================

// ── Regexes de formato ────────────────────────────────────────────────────────

// Android: [DD/MM/YYYY HH:MM:SS] Nome: Mensagem
const ANDROID_RE = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?)\]\s(.+?):\s([\s\S]+)/;

// iOS: DD/MM/YYYY HH:MM - Nome: Mensagem  (com variações de separador e AM/PM)
const IOS_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\s[-–]\s(.+?):\s([\s\S]+)/;

// ── Filtros ───────────────────────────────────────────────────────────────────

// Padrões que indicam mensagem de sistema ou mídia omitida
const SYSTEM_PATTERNS = [
  /^.{0,40}(criou|adicionou|removeu|saiu|entrou|mudou|alterou|administrador)/i,
  /mensagens? e liga[çc][ãa]o/i,
  /end-to-end encrypt/i,
  /<mídia oculta>/i,
  /<media omitted>/i,
  /imagem omitida/i,
  /image omitted/i,
  /video omitido/i,
  /video omitted/i,
  /áudio omitido/i,
  /audio omitted/i,
  /arquivo omitido/i,
  /document omitted/i,
  /figurinha omitida/i,
  /sticker omitted/i,
  /mensagem apagada/i,
  /this message was deleted/i,
];

// ── Anonimização ──────────────────────────────────────────────────────────────

// CPF: 000.000.000-00 ou 00000000000
const CPF_RE    = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
// CNPJ: 00.000.000/0000-00 ou 14 dígitos
const CNPJ_RE   = /\b\d{2}\.?\d{3}\.?\d{3}\/?0001-?\d{2}\b|\b\d{14}\b/g;
// Telefones com DDD: (00) 00000-0000 ou variações
const PHONE_RE  = /\+?[\d\s\-().]{10,16}(?=\s|$)/g;
// E-mails
const EMAIL_RE  = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function anonymizeContent(text) {
  return text
    .replace(CPF_RE,   '[CPF]')
    .replace(CNPJ_RE,  '[CNPJ]')
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(PHONE_RE, (m) => {
      // manter apenas se parece um número de telefone real (mínimo 8 dígitos)
      const digits = m.replace(/\D/g, '');
      return digits.length >= 8 ? '[TELEFONE]' : m;
    });
}

// ── Parser principal ──────────────────────────────────────────────────────────

/**
 * Detecta o formato do arquivo (android | ios | unknown).
 */
function detectFormat(lines) {
  for (const line of lines.slice(0, 20)) {
    if (ANDROID_RE.test(line)) return 'android';
    if (IOS_RE.test(line))     return 'ios';
  }
  return 'unknown';
}

/**
 * Verifica se uma linha é mensagem de sistema ou mídia.
 */
function isSystemMessage(content) {
  return SYSTEM_PATTERNS.some(re => re.test(content));
}

/**
 * Parseia texto exportado do WhatsApp.
 *
 * @param {string} text - Conteúdo bruto do .txt
 * @returns {{ messages: Array<{speaker:string,content:string,timestamp:string}>, format: string, rawSpeakers: string[] }}
 */
export function parseWhatsAppText(text) {
  const lines   = text.split('\n');
  const format  = detectFormat(lines);
  const re      = format === 'android' ? ANDROID_RE : IOS_RE;

  if (format === 'unknown') {
    return { messages: [], format: 'unknown', rawSpeakers: [] };
  }

  const rawMessages = [];
  let current = null;

  for (const line of lines) {
    const match = re.exec(line);
    if (match) {
      if (current) rawMessages.push(current);
      const date    = match[1];
      const time    = match[2];
      const speaker = match[3].trim();
      const content = match[4].trim();

      if (isSystemMessage(content)) {
        current = null;
        continue;
      }
      if (content.length < 2) {
        current = null;
        continue;
      }

      current = { speaker, content, timestamp: `${date} ${time}` };
    } else if (current && line.trim()) {
      // Continuação de mensagem multiline
      current.content += '\n' + line.trim();
    }
  }
  if (current) rawMessages.push(current);

  // Coletar nomes únicos dos falantes
  const speakerCounts = {};
  for (const msg of rawMessages) {
    speakerCounts[msg.speaker] = (speakerCounts[msg.speaker] || 0) + 1;
  }

  // Heurística MVP: quem envia mais mensagens = ATENDENTE
  const rawSpeakers   = Object.keys(speakerCounts);
  const speakersSorted = rawSpeakers.sort((a, b) => speakerCounts[b] - speakerCounts[a]);
  const attendant      = speakersSorted[0] ?? null;

  // Mapear falantes para papéis anônimos
  const roleMap = {};
  for (const s of rawSpeakers) {
    roleMap[s] = s === attendant ? 'ATENDENTE' : 'CLIENTE';
  }

  const messages = rawMessages.map(msg => ({
    speaker:   roleMap[msg.speaker] ?? 'DESCONHECIDO',
    content:   anonymizeContent(msg.content),
    timestamp: msg.timestamp,
  }));

  return { messages, format, rawSpeakers };
}

// ── Score de qualidade ────────────────────────────────────────────────────────

/**
 * Calcula um score de qualidade simples (0–100).
 */
export function calculateQuality(messages) {
  const total = messages.length;

  if (total < 10) {
    return { score: 10, label: 'insuficiente' };
  }

  const attendantMsgs = messages.filter(m => m.speaker === 'ATENDENTE').length;
  const clientMsgs    = messages.filter(m => m.speaker === 'CLIENTE').length;

  // Proporção de troca mínima (não pode ser monólogo)
  const hasBalance = attendantMsgs >= 3 && clientMsgs >= 3;

  // Riqueza de conteúdo (avg palavras por mensagem do atendente)
  const avgWords = messages
    .filter(m => m.speaker === 'ATENDENTE')
    .reduce((acc, m) => acc + m.content.split(/\s+/).length, 0) / Math.max(attendantMsgs, 1);

  let score = 0;
  if (total >= 10)  score += 20;
  if (total >= 30)  score += 15;
  if (total >= 80)  score += 15;
  if (hasBalance)   score += 25;
  if (avgWords >= 5) score += 15;
  if (avgWords >= 10) score += 10;

  score = Math.min(score, 100);

  const label = score >= 70 ? 'boa' : score >= 40 ? 'razoável' : 'insuficiente';
  return { score, label };
}

// ── Preparação para LLM ───────────────────────────────────────────────────────

/**
 * Converte o array de mensagens em texto formatado para envio ao LLM.
 * Limita a 250 mensagens para controlar tokens.
 */
export function formatConversationForLLM(messages, maxMessages = 250) {
  const slice = messages.slice(0, maxMessages);
  return slice
    .map(m => `${m.speaker}: ${m.content}`)
    .join('\n');
}
