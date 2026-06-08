import React, { useState } from 'react';
import { X, UserCheck } from 'lucide-react';

interface CompanyUser {
  user_id: string;
  display_name?: string;
  email?: string;
}

interface BulkAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (responsibleUserId: string | null) => void;
  selectedCount: number;
  companyUsers: CompanyUser[];
  loading: boolean;
}

export const BulkAssignModal: React.FC<BulkAssignModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  selectedCount,
  companyUsers,
  loading,
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string>('__none__');

  if (!isOpen) return null;

  const noUsers = companyUsers.length === 0;

  const handleConfirm = () => {
    if (noUsers) return;
    const userId = selectedUserId === '__none__' ? null : selectedUserId;
    onConfirm(userId);
  };

  const handleClose = () => {
    if (loading) return;
    setSelectedUserId('__none__');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Atribuir Responsável</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">
            Você selecionou{' '}
            <span className="font-semibold text-gray-900">{selectedCount}</span>{' '}
            {selectedCount === 1 ? 'lead' : 'leads'}. Escolha o responsável que será atribuído a{' '}
            {selectedCount === 1 ? 'ele' : 'todos eles'}.
          </p>

          {noUsers ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              Nenhum usuário disponível para atribuição. Aguarde o carregamento da lista de usuários.
            </p>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Responsável
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed bg-white"
              >
                <option value="__none__">— Sem responsável —</option>
                {companyUsers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name || u.email || u.user_id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || noUsers}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Atribuindo...
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4" />
                Confirmar Atribuição
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
