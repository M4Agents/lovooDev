import { describe, expect, it } from 'vitest';
import { describeInstagramModality } from '../instagramModalityEligibility.js';
import { selectableByoAccounts } from '../instagramChatAccounts.js';

const COMPANY_ACTIVE = true;
const ACCOUNT = '17841408602689007';
const CONNECTION = '15e00e55-d0b9-4f8c-a518-f51b74b74e87';
const BYO = '3704590c-e4cb-438b-ac4c-3cec3c4b7a29';
const HEX = 'a'.repeat(64);

function described(overrides = {}) {
  return describeInstagramModality({
    companyActive: COMPANY_ACTIVE,
    connections: [{
      id: CONNECTION,
      status: 'revoked',
      instagram_username: 'usevalleron',
      instagram_user_id: '999',
      ig_webhook_id: ACCOUNT,
    }],
    accounts: [{
      id: BYO,
      instagram_account_id: ACCOUNT,
      instagram_username: 'usevalleron',
      status: 'poc_disabled',
      status_reason: null,
      direct_ingest_enabled: true,
    }],
    operations: [{
      instagram_account_id: ACCOUNT,
      mode: 'byo',
      official_connection_id: null,
      byo_account_id: BYO,
    }],
    credential: {
      validation_status: 'valid',
      webhook_enabled: true,
      webhook_route_id: HEX,
      webhook_verify_token_hash: HEX,
      secret_present: true,
      suat_present: true,
    },
    ...overrides,
  });
}

describe('selectableByoAccounts', () => {
  it('inclui a conta quando a modalidade registrada e a elegibilidade concordam', () => {
    expect(selectableByoAccounts(described())).toEqual([{
      id: BYO,
      instagram_account_id: ACCOUNT,
      username: 'usevalleron',
    }]);
  });

  it('não usa credencial, poc_disabled ou direct_ingest sem modalidade registrada', () => {
    expect(selectableByoAccounts(described({ operations: [] }))).toEqual([]);
  });

  it('não escolhe conta ambígua', () => {
    const accounts = described().map((account) => ({
      ...account,
      targets: { ...account.targets, byo: { eligible: false, block_reason: 'ambiguous_instagram_account' } },
    }));
    expect(selectableByoAccounts(accounts)).toEqual([]);
  });
});
