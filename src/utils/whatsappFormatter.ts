// =====================================================
// WHATSAPP FORMATTER - Conversão de sintaxe WhatsApp
// Data: 17/03/2026
// Objetivo: Converter sintaxe WhatsApp para HTML renderizado
// =====================================================

/**
 * Converte sintaxe de formatação WhatsApp para HTML
 * 
 * Suporta:
 * - *negrito* → <strong>negrito</strong>
 * - _itálico_ → <em>itálico</em>
 * - ~riscado~ → <del>riscado</del>
 * - ```monoespaçado``` → <code>monoespaçado</code>
 * - URLs → Links clicáveis
 * - Quebras de linha → <br/>
 * - Variáveis {{nome}} → Preservadas
 */
export function formatWhatsAppText(text: string): string {
  if (!text) return ''

  return text
    // Negrito: *texto* → <strong>texto</strong>
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    // Itálico: _texto_ → <em>texto</em>
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Riscado: ~texto~ → <del>texto</del>
    .replace(/~([^~]+)~/g, '<del>$1</del>')
    // Monoespaçado: ```texto``` → <code>texto</code>
    .replace(/```([^`]+)```/g, '<code class="bg-gray-100 px-1 rounded">$1</code>')
    // Links: detectar URLs e tornar clicáveis
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-blue-600 underline hover:text-blue-800">$1</a>')
    // Quebras de linha
    .replace(/\n/g, '<br/>')
}

/**
 * Aplica formatação ao texto selecionado ou na posição do cursor
 */
export function applyFormatting(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  formatType: 'bold' | 'italic' | 'strikethrough' | 'monospace' | 'link'
): { newText: string; newCursorPos: number } {
  const before = text.substring(0, selectionStart)
  const selected = text.substring(selectionStart, selectionEnd)
  const after = text.substring(selectionEnd)

  let formatted = ''
  let cursorOffset = 0

  switch (formatType) {
    case 'bold':
      formatted = selected ? `*${selected}*` : '**'
      cursorOffset = selected ? formatted.length : 1
      break
    case 'italic':
      formatted = selected ? `_${selected}_` : '__'
      cursorOffset = selected ? formatted.length : 1
      break
    case 'strikethrough':
      formatted = selected ? `~${selected}~` : '~~'
      cursorOffset = selected ? formatted.length : 1
      break
    case 'monospace':
      formatted = selected ? `\`\`\`${selected}\`\`\`` : '``````'
      cursorOffset = selected ? formatted.length : 3
      break
    case 'link':
      formatted = selected ? selected : 'https://'
      cursorOffset = formatted.length
      break
  }

  const newText = before + formatted + after
  const newCursorPos = selectionStart + cursorOffset

  return { newText, newCursorPos }
}

/**
 * Insere emoji na posição do cursor
 */
export function insertEmoji(
  text: string,
  cursorPos: number,
  emoji: string
): { newText: string; newCursorPos: number } {
  const before = text.substring(0, cursorPos)
  const after = text.substring(cursorPos)
  
  const newText = before + emoji + after
  const newCursorPos = cursorPos + emoji.length

  return { newText, newCursorPos }
}

/**
 * Emojis mais usados no WhatsApp
 */
export const COMMON_EMOJIS = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊',
  '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘',
  '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪',
  '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒',
  '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫',
  '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
  '👍', '👎', '👏', '🙌', '👐', '🤝', '🙏', '✌️',
  '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇',
  '☝️', '✋', '🤚', '🖐', '🖖', '👋', '🤙', '💪',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘',
  '✅', '❌', '⚠️', '🔥', '💯', '⭐', '🌟', '✨',
  '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉'
]
