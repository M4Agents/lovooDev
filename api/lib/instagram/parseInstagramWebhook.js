// =============================================================================
// parseInstagramWebhook — Parser dos payloads reais da Meta (Graph API 2025)
//
// Suporte:
//   - DMs inbound e outbound (is_echo)
//   - Comentários em posts, reels e stories
//
// Payloads documentados e validados contra:
//   https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/
//   https://developers.facebook.com/docs/instagram-platform/webhooks/
//
// NÃO suportado intencionalmente nesta fase:
//   - Seen/read receipts (messaging_seen)
//   - Story mentions
//   - Typing indicators
//
// Reactions (message_reactions) são suportados via parseReactionEvents()

/**
 * Extrai eventos de DM de uma entry do payload Meta.
 *
 * @param {object} entry  Uma entrada de payload.entry[]
 * @returns {Array<DmEvent>}
 */
export function parseDmEvents(entry) {
  const instagramUserId = String(entry.id ?? '');
  const events = [];

  for (const messaging of (entry.messaging ?? [])) {
    const msg = messaging.message;
    if (!msg) continue; // reactions, seen, postbacks — tratados em funções próprias

    const senderId    = String(messaging.sender?.id    ?? '');
    const recipientId = String(messaging.recipient?.id ?? '');
    const isEcho      = !!msg.is_echo;

    const participantId = isEcho ? recipientId : senderId;

    if (!participantId || !msg.mid) continue;

    let messageType = 'text';
    let content     = msg.text ?? null;
    let mediaUrl    = null;

    if (msg.is_deleted) {
      messageType = 'deleted';
      content     = null;
    } else if (msg.is_unsupported) {
      messageType = 'unsupported';
      content     = null;
    } else if (msg.attachments?.length > 0) {
      const att   = msg.attachments[0];
      messageType = att.type ?? 'attachment';
      mediaUrl    = att.payload?.url ?? null;
      content     = null;
    }

    events.push({
      instagramUserId,
      igMessageId:         String(msg.mid),
      igThreadId:          participantId,
      participantIgUserId: participantId,
      direction:           isEcho ? 'outbound' : 'inbound',
      messageType,
      content,
      mediaUrl,
      replyToIgMessageId:  msg.reply_to?.mid ?? null,
      timestamp: new Date(messaging.timestamp ?? Date.now()),
      raw:       messaging,
    });
  }

  return events;
}

/**
 * Extrai eventos de reação de uma entry do payload Meta.
 * messaging.reaction = { mid, action: 'react'|'unreact', emoji }
 *
 * @param {object} entry
 * @returns {Array<ReactionEvent>}
 */
export function parseReactionEvents(entry) {
  const instagramUserId = String(entry.id ?? '');
  const events = [];

  for (const messaging of (entry.messaging ?? [])) {
    if (!messaging.reaction) continue;

    const senderId    = String(messaging.sender?.id    ?? '');
    const recipientId = String(messaging.recipient?.id ?? '');
    const reaction    = messaging.reaction;

    if (!reaction.mid) continue;

    // actor: quem reagiu. Para inbound reactions, sender = participante
    const participantId = senderId;

    events.push({
      instagramUserId,
      participantIgUserId: participantId,
      recipientId,
      igMessageId: String(reaction.mid),
      emoji:       reaction.emoji ?? null,   // unicode emoji (ex: '❤️')
      action:      reaction.action ?? 'react', // 'react' | 'unreact'
      timestamp:   new Date(messaging.timestamp ?? Date.now()),
      raw:         messaging,
    });
  }

  return events;
}

/**
 * Extrai eventos de comentário de uma entry do payload Meta.
 *
 * @param {object} entry  Uma entrada de payload.entry[]
 * @returns {Array<CommentEvent>}
 */
export function parseCommentEvents(entry) {
  const instagramUserId = String(entry.id ?? '');
  const events = [];

  for (const change of (entry.changes ?? [])) {
    if (change.field !== 'comments') continue;

    const v = change.value ?? {};
    const commentId = String(v.id ?? '');
    const mediaId   = String(v.media?.id ?? '');
    const userId    = String(v.from?.id ?? '');

    if (!commentId || !mediaId || !userId) continue; // campos obrigatórios ausentes

    // Timestamp: valor em segundos na value, ou entry.time, ou now
    const tsSeconds = v.timestamp ?? entry.time ?? null;
    const timestamp = tsSeconds
      ? new Date(tsSeconds * 1000)
      : new Date();

    events.push({
      instagramUserId,
      igCommentId:        commentId,
      igMediaId:          mediaId,
      igMediaType:        v.media?.media_product_type ?? null, // 'POST', 'REEL', 'STORY'
      igUserId:           userId,
      igUsername:         v.from?.username ?? null,
      content:            v.text ?? null,
      parentIgCommentId:  v.parent_id ?? null,
      timestamp,
      raw:                change,
    });
  }

  return events;
}

/**
 * Identifica eventos de "outros tipos" no array messaging
 * (reactions, seen, postbacks) para logging como skipped.
 *
 * @param {object} entry
 * @returns {Array<{ instagramUserId, eventType, raw }>}
 */
export function parseSkippedMessagingEvents(entry) {
  const instagramUserId = String(entry.id ?? '');
  const events = [];

  for (const messaging of (entry.messaging ?? [])) {
    if (messaging.message)  continue; // DMs já tratados
    if (messaging.reaction) continue; // reactions tratados por parseReactionEvents

    const eventType = messaging.read      ? 'seen'
      : messaging.postback  ? 'postback'
      : messaging.referral  ? 'referral'
      : 'other_messaging';

    events.push({ instagramUserId, eventType, raw: messaging });
  }

  return events;
}
