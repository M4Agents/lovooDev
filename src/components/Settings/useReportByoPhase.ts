import { useEffect, useRef } from 'react';
import type { ByoAttemptPhase } from './useByoCredentialAttempt';

export function useReportByoPhase(
  phase: ByoAttemptPhase,
  onPhase?: (phase: ByoAttemptPhase) => void,
) {
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;

  useEffect(() => {
    onPhaseRef.current?.(phase);
  }, [phase]);

  useEffect(() => () => onPhaseRef.current?.('edit'), []);
}
