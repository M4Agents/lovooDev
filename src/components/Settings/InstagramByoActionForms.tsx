import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { InstagramByoReplaceForm } from './InstagramByoReplaceForm';
import { InstagramByoRevokeForm } from './InstagramByoRevokeForm';
import { InstagramByoRotateSecretForm } from './InstagramByoRotateSecretForm';
import { InstagramByoRotateSuatForm } from './InstagramByoRotateSuatForm';
import type { ByoAttemptPhase } from './useByoCredentialAttempt';

type ManageAction = 'replace' | 'rotateSecret' | 'rotateSuat' | 'revoke';

type Slot = {
  shown: boolean;
  expectedVersion: number;
  acceptNewAttempt: boolean;
};

type Props = {
  companyId: string;
  action: ManageAction | null;
  onAction: (action: ManageAction | null) => void;
  canManage: boolean;
  externalUncertain: boolean;
  onUncertain: (uncertain: boolean) => void;
  onRefresh: () => void;
  onNotice: (slot: ManageAction, notice: string | null) => void;
  replace: Slot;
  rotateSecret: Slot;
  rotateSuat: Slot;
  revoke: Slot;
};

const IDLE: Record<ManageAction, ByoAttemptPhase> = {
  replace: 'edit',
  rotateSecret: 'edit',
  rotateSuat: 'edit',
  revoke: 'edit',
};

const MANAGE_ACTIONS: { id: ManageAction; label: string }[] = [
  { id: 'replace', label: 'integrations.instagramByo.manageReplace' },
  { id: 'rotateSecret', label: 'integrations.instagramByo.manageRotateSecret' },
  { id: 'rotateSuat', label: 'integrations.instagramByo.manageRotateSuat' },
  { id: 'revoke', label: 'integrations.instagramByo.manageRevoke' },
];

function needsAttention(phase: ByoAttemptPhase) {
  return phase !== 'edit';
}

function isUncertain(phase: ByoAttemptPhase) {
  return phase === 'sending' || phase === 'retryable';
}

function slotFrame(visible: boolean, node: ReactNode) {
  return <div hidden={!visible}>{node}</div>;
}

export function InstagramByoActionForms({
  companyId,
  action,
  onAction,
  canManage,
  externalUncertain,
  onUncertain,
  onRefresh,
  onNotice,
  replace,
  rotateSecret,
  rotateSuat,
  revoke,
}: Props) {
  const { t } = useTranslation('settings.app');
  const slots: Record<ManageAction, Slot> = { replace, rotateSecret, rotateSuat, revoke };
  const [phases, setPhases] = useState(IDLE);
  const previousPhases = useRef(phases);
  const report = useCallback((id: ManageAction, phase: ByoAttemptPhase) => {
    setPhases((current) => (current[id] === phase ? current : { ...current, [id]: phase }));
  }, []);

  useEffect(() => {
    setPhases(IDLE);
  }, [companyId]);

  useEffect(() => {
    const previous = previousPhases.current;
    previousPhases.current = phases;
    if (action && previous[action] !== 'edit' && phases[action] === 'edit') onAction(null);
  }, [phases, action, onAction]);

  const attention = (Object.keys(phases) as ManageAction[]).filter((id) => needsAttention(phases[id]));
  const localUncertain = attention.some((id) => isUncertain(phases[id]));
  const uncertain = externalUncertain || localUncertain;

  useEffect(() => {
    onUncertain(localUncertain);
  }, [localUncertain, onUncertain]);

  const sole = attention.length === 1 ? attention[0] : null;
  const items = MANAGE_ACTIONS.filter((item) => (
    canManage ? slots[item.id].shown : attention.includes(item.id)
  ));

  function conceal(id: ManageAction) {
    return uncertain && phases[id] === 'edit';
  }

  function visible(id: ManageAction) {
    if (!canManage && sole) return id === sole;
    if (action === null && sole) return id === sole;
    return action === id;
  }

  function allowNew(id: ManageAction) {
    if (externalUncertain || (uncertain && phases[id] === 'edit')) return false;
    return slots[id].acceptNewAttempt;
  }

  return (
    <>
      {items.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-900">{t('integrations.instagramByo.manageTitle')}</h4>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('integrations.instagramByo.manageTitle')}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                hidden={conceal(item.id)}
                aria-pressed={action === item.id}
                onClick={() => {
                  if (conceal(item.id)) return;
                  onAction(item.id);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              >
                {t(item.label)}
              </button>
            ))}
          </div>
        </div>
      )}
      {replace.shown && slotFrame(visible('replace'), (
        <InstagramByoReplaceForm
          companyId={companyId}
          expectedVersion={replace.expectedVersion}
          acceptNewAttempt={allowNew('replace')}
          onRefresh={onRefresh}
          onNotice={(notice) => onNotice('replace', notice)}
          onPhase={(phase) => report('replace', phase)}
        />
      ))}
      {rotateSecret.shown && slotFrame(visible('rotateSecret'), (
        <InstagramByoRotateSecretForm
          companyId={companyId}
          expectedVersion={rotateSecret.expectedVersion}
          acceptNewAttempt={allowNew('rotateSecret')}
          onRefresh={onRefresh}
          onNotice={(notice) => onNotice('rotateSecret', notice)}
          onPhase={(phase) => report('rotateSecret', phase)}
        />
      ))}
      {rotateSuat.shown && slotFrame(visible('rotateSuat'), (
        <InstagramByoRotateSuatForm
          companyId={companyId}
          expectedVersion={rotateSuat.expectedVersion}
          acceptNewAttempt={allowNew('rotateSuat')}
          onRefresh={onRefresh}
          onNotice={(notice) => onNotice('rotateSuat', notice)}
          onPhase={(phase) => report('rotateSuat', phase)}
        />
      ))}
      {revoke.shown && slotFrame(visible('revoke'), (
        <InstagramByoRevokeForm
          companyId={companyId}
          expectedVersion={revoke.expectedVersion}
          acceptNewAttempt={allowNew('revoke')}
          onRefresh={onRefresh}
          onNotice={(notice) => onNotice('revoke', notice)}
          onPhase={(phase) => report('revoke', phase)}
        />
      ))}
    </>
  );
}
