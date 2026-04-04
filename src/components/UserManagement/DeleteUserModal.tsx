// =====================================================
// MODAL DE EXCLUSÃO DE USUÁRIO - DESIGN ELEGANTE
// =====================================================

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';
import { CompanyUser } from '../../types/user';

const CONFIRM_DELETE_WORD = 'EXCLUIR';

interface DeleteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (user: CompanyUser) => Promise<void>;
  user: CompanyUser | null;
}

export const DeleteUserModal: React.FC<DeleteUserModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  user
}) => {
  const { t } = useTranslation('settings.app');
  const [step, setStep] = useState<'confirm' | 'type-confirm'>('confirm');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [protectionGuidance, setProtectionGuidance] = useState(false);

  // Reset modal state when opening/closing
  React.useEffect(() => {
    if (isOpen) {
      setStep('confirm');
      setConfirmText('');
      setError(null);
      setLoading(false);
      setProtectionGuidance(false);
    }
  }, [isOpen]);

  const handleFirstConfirm = () => {
    setStep('type-confirm');
  };

  const handleFinalConfirm = async () => {
    if (confirmText !== CONFIRM_DELETE_WORD) {
      setError(t('users.deleteModal.wrongConfirm'));
      return;
    }

    if (!user) return;

    try {
      setLoading(true);
      setError(null);
      setProtectionGuidance(false);
      await onConfirm(user);
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('users.deleteModal.deleteFailed');
      
      if (errorMessage.includes('PROTEÇÃO ATIVADA') || errorMessage.includes('ativo em')) {
        setProtectionGuidance(true);
        setError(null);
      } else {
        setProtectionGuidance(false);
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 transform transition-all duration-200 scale-100">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-full">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              {t('users.deleteModal.title')}
            </h3>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'confirm' ? (
            // Primeira confirmação
            <div className="space-y-4">
              <div className="text-center">
                <div className="p-3 bg-red-100 rounded-full w-16 h-16 mx-auto mb-4">
                  <Trash2 className="w-10 h-10 text-red-600 mx-auto mt-1" />
                </div>
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  {t('users.deleteModal.step1Heading')}
                </h4>
                <p className="text-gray-600 text-sm leading-relaxed">
                  {t('users.deleteModal.step1Before')}{' '}
                  <strong>{t('users.deleteModal.step1Emphasis')}</strong>{' '}
                  {t('users.deleteModal.step1After')}
                </p>
              </div>

              {/* User Info */}
              <div className="bg-gray-50 rounded-lg p-4 border-l-4 border-red-500">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-600">
                      {(user.display_name || user.user_id).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {user.display_name || user.user_id}
                    </p>
                    <p className="text-sm text-gray-500">
                      {user.email || user.user_id}
                    </p>
                  </div>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h5 className="font-medium text-red-800 mb-2">{t('users.deleteModal.warningTitle')}</h5>
                <ul className="text-sm text-red-700 space-y-1">
                  <li>{t('users.deleteModal.warningBullet1')}</li>
                  <li>{t('users.deleteModal.warningBullet2')}</li>
                  <li>{t('users.deleteModal.warningBullet3')}</li>
                </ul>
              </div>
            </div>
          ) : (
            // Segunda confirmação - digitação
            <div className="space-y-4">
              <div className="text-center">
                <div className="p-3 bg-red-100 rounded-full w-16 h-16 mx-auto mb-4">
                  <AlertTriangle className="w-10 h-10 text-red-600 mx-auto mt-1" />
                </div>
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  {t('users.deleteModal.step2Heading')}
                </h4>
                <p className="text-gray-600 text-sm">
                  {t('users.deleteModal.step2Instruction')}
                </p>
              </div>

              <div className="bg-gray-100 rounded-lg p-3 text-center">
                <code className="text-lg font-mono font-bold text-red-600">{CONFIRM_DELETE_WORD}</code>
              </div>

              <div>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => {
                    setConfirmText(e.target.value);
                    setError(null);
                    setProtectionGuidance(false);
                  }}
                  placeholder={t('users.deleteModal.placeholder')}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono"
                  disabled={loading}
                  autoFocus
                />
              </div>

              {protectionGuidance && (
                <div className="border rounded-lg p-4 bg-amber-50 border-amber-200">
                  <div className="text-sm text-amber-800 space-y-2">
                    <p className="font-semibold">{t('users.deleteModal.protectionIntro')}</p>
                    <p>{t('users.deleteModal.protectionP1')}</p>
                    <p className="font-medium">{t('users.deleteModal.protectionStepsTitle')}</p>
                    <p>{t('users.deleteModal.protectionStep1')}</p>
                    <p>{t('users.deleteModal.protectionStep2')}</p>
                    <p>{t('users.deleteModal.protectionFooter')}</p>
                    <p>{t('users.deleteModal.protectionTip')}</p>
                  </div>
                </div>
              )}

              {error && !protectionGuidance && (
                <div className="border rounded-lg p-4 bg-red-50 border-red-200">
                  <div className="text-sm text-red-600">
                    {error.split('\n').map((line, index) => (
                      <div key={index} className={index === 0 ? 'font-semibold mb-2' : 'mb-1'}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-200">
          {step === 'confirm' ? (
            <>
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {t('users.actions.cancel')}
              </button>
              <button
                onClick={handleFirstConfirm}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {t('users.actions.continue')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('confirm')}
                disabled={loading}
                className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {t('users.actions.back')}
              </button>
              <button
                onClick={handleFinalConfirm}
                disabled={loading || confirmText !== CONFIRM_DELETE_WORD}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('users.deleteModal.deleting')}
                  </>
                ) : (
                  t('users.deleteModal.deletePermanent')
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
