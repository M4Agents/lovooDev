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
//   - Reactions (message_reactions)
//   - Seen/read receipts (messaging_seen)
//   - Story mentions
//   - Typing indicators
//
// Formato DM payload (entry.messaging):
// {
//   sender:    { id: "IGSID" }         // customer (inbound) or business (echo)
//   recipient: { id: "IGID" }          // business (inbound) or customer (echo)
//   timestamp: 1569262485349           // ms
//   message: {
//     mid: "MESSAGE-ID",
//     text: "...",                      // optional
//     attachments: [{ type, payload: { url } }],  // optional
//     is_echo: true,                    // outbound (business sent)
//     is_deleted: true,                 // customer deleted message
//     is_unsupported: true,
//     reply_to: { mid }                 // inline reply
//   }
// }
//
// Formato comment payload (entry.changes):
// {
//   field: "comments",
//   value: {
//     from:   { id: "USER_ID", username: "..." },
//     media:  { id: "MEDIA_ID", media_product_type: "POST"|"REEL"|"STORY" },
//     id:     "COMMENT_ID",
//     text:   "...",
//     parent_id: "PARENT_COMMENT_ID",  // optional (reply)
//     timestamp: 1234567890            // optional (seconds)
//   }
// }
// =============================================================================

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
    if (!msg) continue; // reactions, seen, postbacks — ignorados nesta fase

    const senderId    = String(messaging.sender?.id    ?? '');
    const recipientId = String(messaging.recipient?.id ?? '');
    const isEcho      = !!msg.is_echo;

    // Para inbound: sender = cliente, recipient = conta business
    // Para outbound (echo): sender = conta business, recipient = cliente
    const participantId = isEcho ? recipientId : senderId;

    if (!participantId || !msg.mid) continue; // dados obrigatórios ausentes

    // Derivar tipo e conteúdo
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
      messageType = att.type ?? 'attachment';  // 'image', 'video', 'audio', 'file', 'share', etc.
      mediaUrl    = att.payload?.url ?? null;
      content     = null;
    }

    events.push({
      instagramUserId,
      igMessageId:         String(msg.mid),
      igThreadId:          participantId, // IGSID do cliente — identifica a conversa
      participantIgUserId: participantId,
      direction:           isEcho ? 'outbound' : 'inbound',
      messageType,
      content,
      mediaUrl,
      timestamp: new Date(messaging.timestamp ?? Date.now()),
      raw:       messaging,
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
    if (messaging.message) continue; // DMs já tratados

    const eventType = messaging.reaction  ? 'reaction'
      : messaging.read      ? 'seen'
      : messaging.postback  ? 'postback'
      : messaging.referral  ? 'referral'
      : 'other_messaging';

    events.push({ instagramUserId, eventType, raw: messaging });
  }

  return events;
}
