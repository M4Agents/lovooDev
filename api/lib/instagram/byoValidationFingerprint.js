import { createHash } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT_RE = /^[0-9]{5,32}$/;

function part(value) {
  const size = Buffer.byteLength(value, 'utf8');
  return `${size}:${value}`;
}

export function fingerprintByoValidation(input) {
  const companyId = String(input.companyId ?? '').toLowerCase();
  const requestId = String(input.requestId ?? '').toLowerCase();
  const version = input.expectedVersion;
  if (!UUID_RE.test(companyId) || !UUID_RE.test(requestId)) {
    throw new Error('[byoValidationFingerprint] Valor inválido');
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('[byoValidationFingerprint] Valor inválido');
  }
  const chunks = [
    part('byo-fp-v1'),
    part(input.operation),
    part(companyId),
    part(requestId),
    part(String(version)),
  ];
  if (input.operation === 'associate_account') {
    if (typeof input.instagramAccountId !== 'string' || !ACCOUNT_RE.test(input.instagramAccountId)) {
      throw new Error('[byoValidationFingerprint] Valor inválido');
    }
    chunks.push(part(input.instagramAccountId));
  } else if (input.operation !== 'validate') {
    throw new Error('[byoValidationFingerprint] Valor inválido');
  }
  return `s1:${createHash('sha256').update(chunks.join(''), 'utf8').digest('hex')}`;
}
