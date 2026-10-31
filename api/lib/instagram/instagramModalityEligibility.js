// =============================================================================
// Estado operacional da modalidade Instagram, só para leitura.
//
// Sem linha em instagram_account_operations a modalidade oficial é só
// compatibilidade. O recebimento oficial exige conexão active.
// Credencial BYO válida e direct_ingest_enabled não ligam a ingestão.
// Nenhum segredo entra no objeto devolvido.
// =============================================================================

const ACCOUNT_ID = /^[0-9]{5,32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function matchesAccount(connection, accountId) {
  return connection.instagram_user_id === accountId
    || connection.ig_webhook_id === accountId;
}

function presentCredential(row) {
  if (!row) {
    return {
      validation_status: 'not_configured',
      webhook_enabled: false,
      route_ok: false,
      hash_ok: false,
      secret_present: false,
      suat_present: false,
    };
  }
  return {
    validation_status: row.validation_status ?? 'not_configured',
    webhook_enabled: row.webhook_enabled === true,
    route_ok: HEX64.test(row.webhook_route_id ?? ''),
    hash_ok: HEX64.test(row.webhook_verify_token_hash ?? ''),
    secret_present: row.secret_present === true
      || (typeof row.app_secret_enc === 'string' && row.app_secret_enc.length > 0),
    suat_present: row.suat_present === true
      || (typeof row.suat_enc === 'string' && row.suat_enc.length > 0),
  };
}

function byoDestinationReady(account, credential) {
  return Boolean(
    account
    && account.status === 'poc_disabled'
    && account.status_reason == null
    && credential.validation_status === 'valid'
    && credential.webhook_enabled
    && credential.route_ok
    && credential.hash_ok
    && credential.secret_present
    && credential.suat_present,
  );
}

function accountSpan(connection, liveAccounts) {
  const ids = new Set();
  for (const account of liveAccounts) {
    if (
      account.instagram_account_id === connection.instagram_user_id
      || account.instagram_account_id === connection.ig_webhook_id
    ) {
      ids.add(account.id);
    }
  }
  return ids.size;
}

function blocked(reason) {
  return {
    official: { eligible: false, block_reason: reason },
    byo: { eligible: false, block_reason: reason },
  };
}

function describeOne(accountId, input, credential) {
  const matching = input.connections.filter((connection) => matchesAccount(connection, accountId));
  const live = input.accounts.filter((account) => account.instagram_account_id === accountId);
  const modes = input.operations.filter((operation) => operation.instagram_account_id === accountId);
  const connection = matching.length === 1 ? matching[0] : null;
  const account = live.length === 1 ? live[0] : null;

  let identity = null;
  if (!input.companyActive) identity = 'company_inactive';
  else if (matching.length === 0) identity = 'no_official_connection';
  else if (matching.length > 1) identity = 'ambiguous_instagram_account';
  else if (live.length === 0) identity = 'no_byo_account';
  else if (live.length > 1) identity = 'ambiguous_instagram_account';
  else if (accountSpan(connection, input.accounts) !== 1) identity = 'ambiguous_instagram_account';
  else if (modes.length > 1) identity = 'ambiguous_instagram_account';

  let operationalMode = 'official';
  let modeRegistered = false;
  if (!identity && modes.length === 1) {
    const mode = modes[0];
    const officialOwner = mode.mode === 'official'
      && mode.official_connection_id === connection.id
      && mode.byo_account_id == null;
    const byoOwner = mode.mode === 'byo'
      && mode.byo_account_id === account.id
      && mode.official_connection_id == null;
    if (officialOwner || byoOwner) {
      operationalMode = mode.mode;
      modeRegistered = true;
    } else {
      identity = 'mode_conflict';
      operationalMode = null;
    }
  } else if (modes.length === 1 && (modes[0].mode === 'official' || modes[0].mode === 'byo')) {
    operationalMode = modes[0].mode;
    modeRegistered = true;
  } else if (matching.length === 0) {
    operationalMode = null;
  }

  const targets = identity
    ? blocked(identity)
    : {
      official: connection.status === 'active'
        ? { eligible: true, block_reason: null }
        : { eligible: false, block_reason: 'destination_not_ready' },
      byo: byoDestinationReady(account, credential)
        ? { eligible: true, block_reason: null }
        : { eligible: false, block_reason: 'destination_not_ready' },
    };
  const officialReceiveSupported = operationalMode === 'official' && connection?.status === 'active';
  const modeBasis = modeRegistered
    ? 'registered'
    : operationalMode && !identity
      ? 'compatibility'
      : 'none';

  return {
    instagram_account_id: accountId,
    operational_mode: operationalMode,
    mode_registered: modeRegistered,
    mode_basis: modeBasis,
    official_receive_supported: officialReceiveSupported,
    official_connection: connection
      ? {
        id: connection.id,
        status: connection.status,
        username: connection.instagram_username ?? null,
      }
      : null,
    byo_account: account
      ? {
        id: account.id,
        status: account.status,
        username: account.instagram_username ?? null,
        direct_ingest_enabled: account.direct_ingest_enabled === true,
      }
      : null,
    direct_ingest_enabled: account?.direct_ingest_enabled === true,
    send_supported: officialReceiveSupported,
    byo_send_supported: false,
    targets,
  };
}

export function describeInstagramModality(input) {
  const connections = input.connections ?? [];
  const accounts = (input.accounts ?? []).filter((account) => account.status_reason == null);
  const operations = input.operations ?? [];
  const credential = presentCredential(input.credential);
  const keys = new Set();

  for (const account of accounts) {
    if (ACCOUNT_ID.test(account.instagram_account_id ?? '')) keys.add(account.instagram_account_id);
  }
  for (const operation of operations) {
    if (ACCOUNT_ID.test(operation.instagram_account_id ?? '')) keys.add(operation.instagram_account_id);
  }
  for (const connection of connections) {
    const candidates = [connection.ig_webhook_id, connection.instagram_user_id]
      .filter((value) => ACCOUNT_ID.test(value ?? ''));
    if (candidates.some((value) => keys.has(value))) continue;
    if (candidates[0]) keys.add(candidates[0]);
  }

  return [...keys].sort().map((accountId) => describeOne(accountId, {
    connections,
    accounts,
    operations,
    companyActive: input.companyActive === true,
  }, credential));
}
