// Contas BYO que podem aparecer no seletor do chat.
// Exige modalidade registrada e destino BYO elegível ao mesmo tempo.
// Não usa status, credencial ou direct_ingest_enabled isolados.

export function selectableByoAccounts(described) {
  if (!Array.isArray(described)) return [];
  const accounts = [];
  for (const account of described) {
    const byo = account?.byo_account;
    if (account?.mode_basis !== 'registered') continue;
    if (account?.operational_mode !== 'byo') continue;
    if (typeof byo?.id !== 'string' || byo.id === '') continue;
    if (account?.targets?.byo?.eligible !== true) continue;
    accounts.push({
      id: byo.id,
      instagram_account_id: account.instagram_account_id,
      username: typeof byo.username === 'string' ? byo.username : null,
    });
  }
  return accounts;
}
