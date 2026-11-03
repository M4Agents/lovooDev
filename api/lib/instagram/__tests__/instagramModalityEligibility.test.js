import { describe, expect, it } from 'vitest';
import { selectableByoAccounts } from '../instagramChatAccounts.js';
import { describeInstagramModality } from '../instagramModalityEligibility.js';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const CONNECTION = '11111111-1111-4111-8111-111111111111';
const BYO = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '17841400000000001';
const HEX = 'ab'.repeat(32);

function connection(overrides = {}) {
  return {
    id: CONNECTION,
    company_id: COMPANY,
    status: 'active',
    instagram_username: 'oficial',
    instagram_user_id: '9001',
    ig_webhook_id: ACCOUNT,
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    id: BYO,
    company_id: COMPANY,
    instagram_account_id: ACCOUNT,
    instagram_username: 'byo',
    status: 'poc_disabled',
    status_reason: null,
    direct_ingest_enabled: false,
    ...overrides,
  };
}

function credential(overrides = {}) {
  return {
    validation_status: 'valid',
    webhook_enabled: true,
    webhook_route_id: HEX,
    webhook_verify_token_hash: HEX,
    app_secret_enc: 'enc',
    suat_enc: 'enc',
    ...overrides,
  };
}

function byoOperation(overrides = {}) {
  return {
    instagram_account_id: ACCOUNT,
    mode: 'byo',
    official_connection_id: null,
    byo_account_id: BYO,
    ...overrides,
  };
}

function described(overrides = {}) {
  return describeInstagramModality({
    companyActive: true,
    connections: [connection()],
    accounts: [account()],
    operations: [],
    credential: credential(),
    ...overrides,
  });
}

describe('describeInstagramModality', () => {
  it('mantém o oficial quando não existe registro, mesmo com credencial válida', () => {
    const [row] = described();
    expect(row.operational_mode).toBe('official');
    expect(row.mode_registered).toBe(false);
    expect(row.mode_basis).toBe('compatibility');
    expect(row.official_receive_supported).toBe(true);
    expect(row.send_supported).toBe(true);
    expect(row.targets.official.eligible).toBe(true);
    expect(row.targets.byo.eligible).toBe(true);
    expect(row.byo_send_supported).toBe(false);
    expect(JSON.stringify(row)).not.toContain('app_secret');
    expect(JSON.stringify(row)).not.toContain(HEX);
  });

  it('não trata a flag de ingestão como modalidade BYO', () => {
    const [row] = described({
      accounts: [account({ direct_ingest_enabled: true })],
      credential: credential({ webhook_enabled: false }),
    });
    expect(row.operational_mode).toBe('official');
    expect(row.direct_ingest_enabled).toBe(true);
    expect(row.targets.byo).toEqual({ eligible: false, block_reason: 'destination_not_ready' });
  });

  it('bloqueia destino oficial revogado e credencial incompleta', () => {
    const [row] = described({
      connections: [connection({ status: 'revoked' })],
      credential: credential({ validation_status: 'failed' }),
    });
    expect(row.operational_mode).toBe('official');
    expect(row.mode_registered).toBe(false);
    expect(row.mode_basis).toBe('compatibility');
    expect(row.official_receive_supported).toBe(false);
    expect(row.send_supported).toBe(false);
    expect(row.targets.official.block_reason).toBe('destination_not_ready');
    expect(row.targets.byo.block_reason).toBe('destination_not_ready');
  });

  it('trata a reconexão oficial no mesmo connection_id como recebimento real', () => {
    const revoked = described({ connections: [connection({ status: 'revoked' })] })[0];
    const active = described({ connections: [connection({ status: 'active' })] })[0];
    expect(revoked.official_connection.id).toBe(CONNECTION);
    expect(active.official_connection.id).toBe(CONNECTION);
    expect(revoked.official_receive_supported).toBe(false);
    expect(active.official_receive_supported).toBe(true);
    expect(active.send_supported).toBe(true);
    expect(active.mode_registered).toBe(false);
  });

  it('aceita a presença do segredo sem carregar o ciphertext', () => {
    const [row] = described({
      credential: credential({
        app_secret_enc: undefined,
        suat_enc: undefined,
        secret_present: true,
        suat_present: true,
      }),
    });
    expect(row.targets.byo.eligible).toBe(true);
    expect(JSON.stringify(row)).not.toContain('ciphertext');
  });

  it('bloqueia identificador ambíguo e conta de outra identidade', () => {
    const ambiguous = described({
      connections: [
        connection(),
        connection({ id: '33333333-3333-4333-8333-333333333333', instagram_user_id: ACCOUNT }),
      ],
    });
    expect(ambiguous[0].targets.byo.block_reason).toBe('ambiguous_instagram_account');

    const mismatch = described({
      connections: [connection({ ig_webhook_id: '17841400000000009', instagram_user_id: '17841400000000008' })],
    });
    expect(mismatch.some((row) => row.targets.byo.block_reason === 'no_official_connection'
      || row.targets.official.block_reason === 'no_byo_account')).toBe(true);
  });
});

describe('BYO sem conexão oficial', () => {
  function withoutConnection(overrides = {}) {
    return described({
      connections: [],
      operations: [byoOperation()],
      ...overrides,
    });
  }

  it('inclui no seletor a conta BYO inequívoca e mantém o oficial inelegível', () => {
    const rows = withoutConnection();
    expect(rows).toHaveLength(1);
    expect(rows[0].operational_mode).toBe('byo');
    expect(rows[0].mode_basis).toBe('registered');
    expect(rows[0].official_connection).toBeNull();
    expect(rows[0].targets.byo).toEqual({ eligible: true, block_reason: null });
    expect(rows[0].targets.official).toEqual({ eligible: false, block_reason: 'no_official_connection' });
    expect(rows[0].official_receive_supported).toBe(false);
    expect(rows[0].send_supported).toBe(false);
    expect(rows[0].byo_send_supported).toBe(false);
    expect(selectableByoAccounts(rows)).toEqual([{
      id: BYO,
      instagram_account_id: ACCOUNT,
      username: 'byo',
    }]);
  });

  it('bloqueia a conta sem operação BYO', () => {
    const rows = withoutConnection({ operations: [] });
    expect(rows[0].targets.byo.eligible).toBe(false);
    expect(selectableByoAccounts(rows)).toEqual([]);
  });

  it('bloqueia a operação sem conta BYO', () => {
    const rows = withoutConnection({ accounts: [] });
    expect(rows[0].targets.byo.eligible).toBe(false);
    expect(rows[0].byo_account).toBeNull();
    expect(selectableByoAccounts(rows)).toEqual([]);
  });

  it('bloqueia operação apontando para outra conta BYO', () => {
    const rows = withoutConnection({
      operations: [byoOperation({ byo_account_id: '33333333-3333-4333-8333-333333333333' })],
    });
    expect(rows[0].targets.byo.eligible).toBe(false);
    expect(selectableByoAccounts(rows)).toEqual([]);
  });

  it('bloqueia contas ou operações ambíguas', () => {
    const manyAccounts = withoutConnection({
      accounts: [
        account(),
        account({ id: '33333333-3333-4333-8333-333333333333' }),
      ],
    });
    const manyOperations = withoutConnection({
      operations: [
        byoOperation(),
        byoOperation({ byo_account_id: '33333333-3333-4333-8333-333333333333' }),
      ],
    });
    expect(selectableByoAccounts(manyAccounts)).toEqual([]);
    expect(selectableByoAccounts(manyOperations)).toEqual([]);
    expect(manyAccounts[0].targets.byo.eligible).toBe(false);
    expect(manyOperations[0].targets.byo.eligible).toBe(false);
  });

  it('bloqueia empresa inativa', () => {
    const rows = withoutConnection({ companyActive: false });
    expect(rows[0].targets.byo).toEqual({ eligible: false, block_reason: 'company_inactive' });
    expect(rows[0].targets.official.eligible).toBe(false);
    expect(selectableByoAccounts(rows)).toEqual([]);
  });

  it('bloqueia modalidade oficial sem conexão oficial', () => {
    const rows = withoutConnection({
      operations: [byoOperation({ mode: 'official', byo_account_id: null, official_connection_id: CONNECTION })],
    });
    expect(rows[0].targets.official.eligible).toBe(false);
    expect(rows[0].targets.byo.eligible).toBe(false);
    expect(rows[0].send_supported).toBe(false);
    expect(rows[0].byo_send_supported).toBe(false);
    expect(selectableByoAccounts(rows)).toEqual([]);
  });
});
