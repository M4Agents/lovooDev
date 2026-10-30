// Conversa BYO não tem conexão oficial. connection_id nulo também bloqueia
// o envio, para a consulta da conexão não receber um id vazio.

export function isByoConversation(row) {
  return Boolean(row) && (row.byo_account_id != null || row.connection_id == null);
}

export function rejectByoSend(res) {
  return res.status(422).json({
    error: 'byo_send_disabled',
    message: 'O envio por esta conta Instagram ainda não está disponível.',
  });
}
