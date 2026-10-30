import { useEffect, useRef, useState } from 'react';

export type ByoAttemptPhase = 'edit' | 'confirm' | 'sending' | 'retryable';

export type ByoWriteNotice =
  | 'applied'
  | 'idempotent'
  | 'stale'
  | 'conflict'
  | 'request_reused'
  | 'rejected'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable'
  | 'too_large'
  | 'unsupported_media'
  | 'service_unavailable'
  | 'unknown';

export type ByoAttemptResult =
  | {
    kind: 'ok';
    body: {
      stale: boolean;
      result: 'applied' | 'idempotent' | 'already_revoked';
    };
  }
  | { kind: 'rejected' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'conflict' }
  | { kind: 'request_reused' }
  | { kind: 'too_large' }
  | { kind: 'unsupported_media' }
  | { kind: 'service_unavailable' }
  | { kind: 'network' }
  | { kind: 'session_unavailable' }
  | { kind: 'temporary' };

export type ByoAttemptDecision =
  | { type: 'retry'; notice: 'unknown' }
  | {
    type: 'stop';
    notice: ByoWriteNotice;
    clearFields: boolean;
    refresh: boolean;
  };

type AttemptIdentity = {
  companyId: string;
  requestId: string;
};

function createRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function decideByoAttempt(
  result: ByoAttemptResult,
  retryingUnknown: boolean,
): ByoAttemptDecision {
  const sessionLost = result.kind === 'unauthorized' || result.kind === 'session_unavailable';
  if (
    result.kind === 'network'
    || result.kind === 'service_unavailable'
    || (retryingUnknown && sessionLost)
  ) {
    return { type: 'retry', notice: 'unknown' };
  }
  if (sessionLost) {
    return { type: 'stop', notice: 'unauthorized', clearFields: false, refresh: false };
  }
  if (result.kind === 'conflict' || result.kind === 'request_reused') {
    return { type: 'stop', notice: result.kind, clearFields: true, refresh: true };
  }
  if (result.kind === 'ok') {
    const notice: ByoWriteNotice = result.body.stale
      ? 'stale'
      : result.body.result === 'idempotent'
        ? 'idempotent'
        : 'applied';
    return { type: 'stop', notice, clearFields: true, refresh: true };
  }
  const notice: ByoWriteNotice = result.kind === 'temporary' ? 'rejected' : result.kind;
  return { type: 'stop', notice, clearFields: false, refresh: false };
}

export function useByoCredentialAttempt<T extends AttemptIdentity>(options: {
  companyId: string;
  onNotice: (notice: ByoWriteNotice | null) => void;
  onRefresh: () => void;
  onClearFields: () => void;
  execute: (attempt: T) => Promise<ByoAttemptResult>;
}) {
  const [phase, setPhase] = useState<ByoAttemptPhase>('edit');
  const [attempt, setAttempt] = useState<T | null>(null);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const companyRef = useRef(options.companyId);
  const clearRef = useRef(options.onClearFields);
  const noticeRef = useRef(options.onNotice);
  const refreshRef = useRef(options.onRefresh);
  const executeRef = useRef(options.execute);
  companyRef.current = options.companyId;
  clearRef.current = options.onClearFields;
  noticeRef.current = options.onNotice;
  refreshRef.current = options.onRefresh;
  executeRef.current = options.execute;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    clearRef.current();
    setPhase('edit');
    setAttempt(null);
  }, [options.companyId]);

  function confirm(fields: Omit<T, 'requestId'>) {
    setAttempt({ ...fields, requestId: createRequestId() } as T);
    setPhase('confirm');
    noticeRef.current(null);
  }

  function cancel() {
    setPhase('edit');
    setAttempt(null);
  }

  function discard() {
    clearRef.current();
    setAttempt(null);
    setPhase('edit');
  }

  async function send(current: T) {
    if (sendingRef.current) return;
    const retryingUnknown = phase === 'retryable';
    sendingRef.current = true;
    setPhase('sending');
    let result: ByoAttemptResult;
    try {
      result = await executeRef.current(current);
    } finally {
      sendingRef.current = false;
    }
    if (!mountedRef.current || current.companyId !== companyRef.current) return;
    const decision = decideByoAttempt(result, retryingUnknown);
    if (decision.type === 'retry') {
      setPhase('retryable');
      noticeRef.current(decision.notice);
      return;
    }
    if (decision.clearFields) clearRef.current();
    setPhase('edit');
    setAttempt(null);
    noticeRef.current(decision.notice);
    if (decision.refresh) refreshRef.current();
  }

  return { phase, attempt, confirm, cancel, discard, send };
}
