import type { ByoStatusPayload } from '../../services/instagramByoApi';
import { resolveByoSetMode } from '../../services/instagramByoApi';

export type ByoSync = 'initial' | 'ready' | 'refreshing' | 'unconfirmed';
export type ByoFault = 'unavailable' | 'denied' | 'temporary' | null;

const STATUS_VALUE: Record<string, string> = {
  saved: 'integrations.instagramByo.statusSaved',
  pending: 'integrations.instagramByo.statusPending',
  valid: 'integrations.instagramByo.statusRegistered',
  failed: 'integrations.instagramByo.statusFailed',
  revoked: 'integrations.instagramByo.statusRevokedShort',
  not_configured: 'integrations.instagramByo.stateCredentials',
};

export function byoStatusValueKey(validationStatus: string): string {
  return STATUS_VALUE[validationStatus] ?? 'integrations.instagramByo.statusRegistered';
}

export function byoStatusMessageKey(
  sync: ByoSync,
  fault: ByoFault,
  snapshot: ByoStatusPayload | null,
): string | null {
  if (!snapshot && fault === 'unavailable') return 'integrations.instagramByo.statusUnavailable';
  if (!snapshot && fault === 'denied') return 'integrations.instagramByo.statusDenied';
  if (!snapshot && fault === 'temporary') return 'integrations.instagramByo.statusTemporary';
  if (!snapshot) return 'integrations.instagramByo.statusLoading';
  if (sync === 'refreshing') return 'integrations.instagramByo.statusRefreshing';
  if (sync === 'unconfirmed') return 'integrations.instagramByo.statusUnconfirmed';
  if (!snapshot.credentials.configured) {
    const mode = resolveByoSetMode(snapshot.credentials);
    if (mode.kind === 'initial') return 'integrations.instagramByo.stateCredentials';
    if (mode.kind === 'revoked') return 'integrations.instagramByo.statusRevoked';
    return 'integrations.instagramByo.statusSetBlocked';
  }
  if (snapshot.credentials.validation_status === 'saved') {
    return 'integrations.instagramByo.statusSaved';
  }
  return byoStatusValueKey(snapshot.credentials.validation_status);
}
