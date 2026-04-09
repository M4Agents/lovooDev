// =============================================================================
// api/lib/agents/responseComposer.js
//
// ResponseComposer — Etapa 8 MVP Agentes de Conversação
//
// RESPONSABILIDADE ÚNICA:
//   Transformar raw_response (string única do LLM) em múltiplos blocos de
//   texto curtos, naturais e prontos para envio sequencial no WhatsApp.
//   Não envia mensagens. Não acessa o banco. Não chama APIs externas.
//
// ESTRATÉGIA DE DIVISÃO (ordem de prioridade):
//   1. Dividir por parágrafos (\n\n) — respeita estrutura intencional do LLM
//   2. Para blocos longos:
//      a. Se for lista (2+ itens com marcador): splitList()
//      b. Senão: splitBySentences() — agrupa frases até MAX_BLOCK_CHARS
//   3. Para sentenças longas: splitByClauses() (vírgulas)
//   4. Último recurso: hardSplit() no último espaço antes do limite
//
// PRINCÍPIOS DE DESIGN:
//   - Preservar listas e bullets como unidade (itens não ficam isolados)
//   - Não fragmentar respostas curtas (< MAX_BLOCK_CHARS ficam intactas)
//   - Nunca cortar palavra ao meio
//   - Manter contexto: nunca quebrar no meio de uma frase se há espaço
//
// CONSTANTES:
//   MAX_BLOCK_CHARS    = 300   → tamanho alvo por bloco (UX WhatsApp)
//   MIN_BLOCK_CHARS    = 3     → blocos menores são descartados
//   MAX_BLOCKS         = 10    → teto para evitar flood de mensagens
//   WHATSAPP_HARD_LIMIT = 4096 → limite real da API (defesa final)
//
// RETORNO:
//   { success: true, output: ResponseComposerOutput }
//   { success: false, skip_reason: 'empty_response' | 'no_valid_blocks' }
// =============================================================================

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_BLOCK_CHARS     = 300;
const MIN_BLOCK_CHARS     = 3;
const MAX_BLOCKS          = 10;
const WHATSAPP_HARD_LIMIT = 4096;

/** Padrão de marcador de item de lista (-, *, •, +, 1., 1)) */
const LIST_ITEM_PATTERN = /^(\s*[-*•+]|\s*\d+[.)]) /;

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Transforma AgentExecutorOutput em ResponseComposerOutput (array de blocos).
 *
 * @param {object} agentExecutorOutput — saída do AgentExecutor (Etapa 7)
 * @returns {{ success: boolean, output?: ResponseComposerOutput, skip_reason?: string }}
 */
export function compose(agentExecutorOutput) {
  const rawResponse = agentExecutorOutput?.raw_response;

  // ── 1. Validar input ──────────────────────────────────────────────────────
  if (!rawResponse || !rawResponse.trim()) {
    console.log('🤖 [COMPOSE] ⏭️  raw_response vazio — skip');
    return { success: false, skip_reason: 'empty_response' };
  }

  // ── 2. Sanitizar ─────────────────────────────────────────────────────────
  const sanitized = sanitize(rawResponse);

  // ── 3. Dividir por parágrafos ─────────────────────────────────────────────
  // \n\n+ → parágrafo intencional. Preservamos \n simples dentro de blocos.
  const candidates = sanitized
    .split(/\n\n+/)
    .map(c => c.trim())
    .filter(c => c.length > 0);

  // ── 4. Processar cada candidato ───────────────────────────────────────────
  const rawBlocks = [];
  for (const candidate of candidates) {
    if (candidate.length <= MAX_BLOCK_CHARS) {
      rawBlocks.push(candidate);
    } else {
      const subBlocks = splitLongBlock(candidate);
      rawBlocks.push(...subBlocks);
    }
  }

  // ── 5. Validar e filtrar ──────────────────────────────────────────────────
  let validBlocks = rawBlocks
    .map(b => b.trim())
    .filter(b => b.length >= MIN_BLOCK_CHARS);

  // Descartar blocos acima do hard limit (não deve ocorrer, mas é defesa final)
  const overLimit = validBlocks.filter(b => b.length > WHATSAPP_HARD_LIMIT);
  if (overLimit.length > 0) {
    console.warn('🤖 [COMPOSE] ⚠️  descartando blocos > WHATSAPP_HARD_LIMIT:', overLimit.length);
    validBlocks = validBlocks.filter(b => b.length <= WHATSAPP_HARD_LIMIT);
  }

  // Truncar ao máximo de blocos
  if (validBlocks.length > MAX_BLOCKS) {
    console.warn(`🤖 [COMPOSE] ⚠️  truncando ${validBlocks.length} blocos para o máximo de ${MAX_BLOCKS}`);
    validBlocks = validBlocks.slice(0, MAX_BLOCKS);
  }

  // Sem blocos válidos após processamento
  if (validBlocks.length === 0) {
    console.log('🤖 [COMPOSE] ⏭️  nenhum bloco válido após processamento — skip');
    return { success: false, skip_reason: 'no_valid_blocks' };
  }

  // ── 6. Montar ResponseComposerOutput ─────────────────────────────────────
  const blocks = validBlocks.map((content, index) => ({
    index,
    type: 'text',
    content
  }));

  console.log('🤖 [COMPOSE] ✅ Composição concluída:', {
    raw_length:    rawResponse.length,
    blocks_count:  blocks.length,
    block_lengths: blocks.map(b => b.content.length)
  });

  return {
    success: true,
    output: {
      run_id:     agentExecutorOutput.run_id,
      session_id: agentExecutorOutput.session_id,
      blocks,
      metadata:   agentExecutorOutput.metadata
    }
  };
}

// ── Sanitização ───────────────────────────────────────────────────────────────

/**
 * Normaliza espaçamentos e quebras de linha sem alterar o conteúdo semântico.
 */
function sanitize(text) {
  return text
    .replace(/\r\n/g, '\n')      // Windows → Unix
    .replace(/\r/g, '\n')         // Mac antigo → Unix
    .replace(/\n{3,}/g, '\n\n')  // 3+ linhas em branco → 2
    .replace(/[ \t]+$/gm, '')     // espaços à direita de cada linha
    .trim();
}

// ── Divisão de blocos longos ──────────────────────────────────────────────────

/**
 * Escolhe a estratégia correta para dividir um bloco que excede MAX_BLOCK_CHARS.
 * Detecta listas (2+ linhas com marcador) e as trata como caso especial.
 */
function splitLongBlock(text) {
  const lines = text.split('\n');
  const listItemCount = lines.filter(l => LIST_ITEM_PATTERN.test(l)).length;

  // Se 2 ou mais linhas são itens de lista: usar estratégia de lista
  if (listItemCount >= 2) {
    return splitList(lines);
  }

  return splitBySentences(text);
}

// ── Estratégia para listas ────────────────────────────────────────────────────

/**
 * Agrupa linhas de uma lista em blocos respeitando MAX_BLOCK_CHARS.
 * Mantém o cabeçalho da lista junto ao primeiro grupo de itens quando possível.
 * Nunca isola um cabeçalho sem itens.
 */
function splitList(lines) {
  const blocks = [];
  let current = '';

  for (const line of lines) {
    if (!line.trim()) continue;

    const candidate = current ? current + '\n' + line : line;

    if (candidate.length <= MAX_BLOCK_CHARS) {
      current = candidate;
    } else {
      if (current) blocks.push(current);

      if (line.length > MAX_BLOCK_CHARS) {
        // Item de lista excessivamente longo: hard split
        const parts = hardSplit(line, MAX_BLOCK_CHARS);
        blocks.push(...parts.slice(0, -1));
        current = parts[parts.length - 1] ?? '';
      } else {
        current = line;
      }
    }
  }

  if (current.trim()) blocks.push(current.trim());
  return blocks.filter(b => b.trim().length >= MIN_BLOCK_CHARS);
}

// ── Estratégia por sentenças ──────────────────────────────────────────────────

/**
 * Extrai sentenças e as agrupa em blocos de até MAX_BLOCK_CHARS.
 * Para sentenças individuais longas, delega a splitByClauses().
 */
function splitBySentences(text) {
  const sentences = extractSentences(text);
  const blocks = [];
  let current = '';

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    if (current === '') {
      if (sentence.length > MAX_BLOCK_CHARS) {
        const clauseBlocks = splitByClauses(sentence);
        blocks.push(...clauseBlocks.slice(0, -1));
        current = clauseBlocks[clauseBlocks.length - 1] ?? '';
      } else {
        current = sentence;
      }
    } else {
      // Usar espaço como separador entre sentenças (não adicionar se já termina com \n)
      const sep = current.endsWith('\n') ? '' : ' ';
      const candidate = current + sep + sentence;

      if (candidate.length <= MAX_BLOCK_CHARS) {
        current = candidate;
      } else {
        blocks.push(current);
        if (sentence.length > MAX_BLOCK_CHARS) {
          const clauseBlocks = splitByClauses(sentence);
          blocks.push(...clauseBlocks.slice(0, -1));
          current = clauseBlocks[clauseBlocks.length - 1] ?? '';
        } else {
          current = sentence;
        }
      }
    }
  }

  if (current.trim()) blocks.push(current.trim());
  return blocks.filter(b => b.trim().length >= MIN_BLOCK_CHARS);
}

/**
 * Divide texto em sentenças, mantendo a pontuação final anexada à sentença.
 * Delimita por: ". ", "! ", "? " (seguido de espaço ou fim de string).
 * Fallback: retorna o texto inteiro como única sentença.
 */
function extractSentences(text) {
  const sentences = [];
  let lastIndex = 0;

  // Delimitar pelo padrão: pontuação final [.!?] + aspas opcionais + espaço
  const regex = /[.!?]["']?\s+/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // A sentença inclui a pontuação final (sem o espaço posterior)
    const end = match.index + match[0].trimEnd().length;
    const sentence = text.slice(lastIndex, end).trim();
    if (sentence) sentences.push(sentence);
    lastIndex = match.index + match[0].length;
  }

  // Texto remanescente sem terminador (ex: último parágrafo sem ponto)
  const remaining = text.slice(lastIndex).trim();
  if (remaining) sentences.push(remaining);

  return sentences.length > 0 ? sentences : [text.trim()];
}

// ── Estratégia por cláusulas (fallback para sentenças longas) ─────────────────

/**
 * Divide uma sentença longa por vírgulas, mantendo a vírgula na cláusula anterior.
 * Fallback final: hardSplit().
 */
function splitByClauses(sentence) {
  // Separar em cláusulas preservando a vírgula no final de cada uma
  const parts = sentence.split(/,\s*/);
  const blocks = [];
  let current = '';

  for (let i = 0; i < parts.length; i++) {
    // Reintroduzir vírgula exceto na última parte
    const clause = i < parts.length - 1 ? parts[i] + ',' : parts[i];
    const candidate = current ? current + ' ' + clause : clause;

    if (candidate.length <= MAX_BLOCK_CHARS) {
      current = candidate;
    } else {
      if (current) blocks.push(current);

      if (clause.length > MAX_BLOCK_CHARS) {
        const hardParts = hardSplit(clause, MAX_BLOCK_CHARS);
        blocks.push(...hardParts.slice(0, -1));
        current = hardParts[hardParts.length - 1] ?? '';
      } else {
        current = clause;
      }
    }
  }

  if (current.trim()) blocks.push(current.trim());

  // Se não gerou blocos, cair em hardSplit
  return blocks.length > 0
    ? blocks.filter(b => b.trim().length >= MIN_BLOCK_CHARS)
    : hardSplit(sentence, MAX_BLOCK_CHARS);
}

// ── Hard split (último recurso) ───────────────────────────────────────────────

/**
 * Corta o texto no último espaço antes de maxChars.
 * Nunca corta no meio de uma palavra.
 * Acionado apenas quando nenhuma estratégia semântica foi suficiente.
 */
function hardSplit(text, maxChars) {
  const blocks = [];
  let remaining = text.trim();

  while (remaining.length > maxChars) {
    let cutPoint = remaining.lastIndexOf(' ', maxChars);

    if (cutPoint <= 0) {
      // Sem espaço no intervalo: força corte no limite (evita loop infinito)
      cutPoint = maxChars;
    }

    blocks.push(remaining.slice(0, cutPoint).trim());
    remaining = remaining.slice(cutPoint).trim();
  }

  if (remaining) blocks.push(remaining);
  return blocks.filter(b => b.trim().length > 0);
}
