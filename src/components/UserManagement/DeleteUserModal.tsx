// =====================================================
// MODAL DE EXCLUSÃO DE USUÁRIO - DESIGN ELEGANTE
// =====================================================

import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';
import { CompanyUser } from '../../types/user';

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
  const [step, setStep] = useState<'confirm' | 'type-confirm'>('confirm');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset modal state when opening/closing
  React.useEffect(() => {
    if (isOpen) {
      setStep('confirm');
      setConfirmText('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  const handleFirstConfirm = () => {
    setStep('type-confirm');
  };

  const handleFinalConfirm = async () => {
    if (confirmText !== 'EXCLUIR') {
      setError('Texto de confirmação incorreto. Digite exatamente: EXCLUIR');
      return;
    }

    if (!user) return;

    try {
      setLoading(true);
      setError(null);
      await onConfirm(user);
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao excluir usuário';
      
      // Detectar erro de proteção e fornecer orientação clara
      if (errorMessage.includes('PROTEÇÃO ATIVADA') || errorMessage.includes('ativo em')) {
        setError(`🛡️ Usuário Protegido Contra Exclusão

Este usuário ainda está ATIVO no sistema e não pode ser excluído diretamente.

📋 Para excluir com segurança, siga estes passos:

1️⃣ Primeiro: Clique no botão LARANJA (👤❌) para DESATIVAR o usuário
2️⃣ Depois: Clique no botão VERMELHO (🗑️) para EXCLUIR permanentemente

🔒 Esta proteção evita exclusões acidentais de usuários ativos.

💡 Dica: Usuários desativados podem ser reativados, mas usuários excluídos não podem ser recuperados.`);
      } else {
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
              Exclusão Permanente
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
                  Tem certeza absoluta?
                </h4>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Você está prestes a <strong>excluir permanentemente</strong> o usuário:
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
                <h5 className="font-medium text-red-800 mb-2">⚠️ ATENÇÃO: Esta ação NÃO pode ser desfeita!</h5>
                <ul className="text-sm text-red-700 space-y-1">
                  <li>• O usuário será removido completamente do sistema</li>
                  <li>• Todos os dados e histórico serão perdidos</li>
                  <li>• Não será possível recuperar as informações</li>
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
                  Confirmação Final
                </h4>
                <p className="text-gray-600 text-sm">
                  Para confirmar a exclusão permanente, digite exatamente:
                </p>
              </div>

              <div className="bg-gray-100 rounded-lg p-3 text-center">
                <code className="text-lg font-mono font-bold text-red-600">EXCLUIR</code>
              </div>

              <div>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => {
                    setConfirmText(e.target.value);
                    setError(null);
                  }}
                  placeholder="Digite: EXCLUIR"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono"
                  disabled={loading}
                  autoFocus
                />
              </div>

              {error && (
                <div className={`border rounded-lg p-4 ${
                  error.includes('🛡️ Usuário Protegido') 
                    ? 'bg-amber-50 border-amber-200' 
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className={`text-sm ${
                    error.includes('🛡️ Usuário Protegido')
                      ? 'text-amber-800'
                      : 'text-red-600'
                  }`}>
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
                Cancelar
              </button>
              <button
                onClick={handleFirstConfirm}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Continuar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('confirm')}
                disabled={loading}
                className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                onClick={handleFinalConfirm}
                disabled={loading || confirmText !== 'EXCLUIR'}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  'Excluir Permanentemente'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
