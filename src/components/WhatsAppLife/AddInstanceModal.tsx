// =====================================================
// ADD INSTANCE MODAL - MODAL PARA CRIAR INSTÂNCIA
// =====================================================
// Modal para capturar nome da instância antes de criar

import React, { useState } from 'react';
import { X, Smartphone, AlertCircle } from 'lucide-react';

interface AddInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (instanceName: string) => Promise<void>;
  loading?: boolean;
  planLimits: {
    canAdd: boolean;
    remaining: number;
    maxAllowed: number;
    currentCount: number;
  };
}

export const AddInstanceModal: React.FC<AddInstanceModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  loading = false,
  planLimits
}) => {
  const [instanceName, setInstanceName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validações
    if (!instanceName.trim()) {
      setError('Nome da instância é obrigatório');
      return;
    }

    if (instanceName.trim().length < 3) {
      setError('Nome deve ter pelo menos 3 caracteres');
      return;
    }

    if (instanceName.trim().length > 50) {
      setError('Nome deve ter no máximo 50 caracteres');
      return;
    }

    // Validar caracteres permitidos
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(instanceName.trim())) {
      setError('Nome pode conter apenas letras, números, espaços, hífens e underscores');
      return;
    }

    try {
      setError('');
      await onConfirm(instanceName.trim());
      setInstanceName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar instância');
    }
  };

  const handleClose = () => {
    if (!loading) {
      setInstanceName('');
      setError('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Smartphone className="h-6 w-6 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Conectar WhatsApp
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6">
          {/* Plan Info */}
          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <Smartphone className="h-4 w-4" />
              <span>
                {planLimits.remaining} de {planLimits.maxAllowed} instâncias disponíveis
              </span>
            </div>
          </div>

          {/* Input */}
          <div className="mb-4">
            <label htmlFor="instanceName" className="block text-sm font-medium text-gray-700 mb-2">
              Nome da Instância
            </label>
            <input
              type="text"
              id="instanceName"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              placeholder="Ex: WhatsApp Vendas, Suporte, etc."
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              maxLength={50}
            />
            <div className="mt-1 text-xs text-gray-500">
              {instanceName.length}/50 caracteres
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !planLimits.canAdd || !instanceName.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Criando...' : 'Criar Instância'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
