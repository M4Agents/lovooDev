import React, { useState } from 'react';
import { X, Merge, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import type { DuplicateNotification } from './DuplicateNotifications';

interface BulkMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMergeComplete: () => void;
  notifications: DuplicateNotification[];
}

type MergeStrategy = 'keep_existing' | 'keep_new' | 'merge_fields';

export const BulkMergeModal: React.FC<BulkMergeModalProps> = ({
  isOpen,
  onClose,
  onMergeComplete,
  notifications,
}) => {
  const [strategy, setStrategy] = useState<MergeStrategy>('merge_fields');
  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  if (!isOpen) return null;

  const count = notifications.length;

  const handleMerge = async () => {
    if (count === 0) return;

    setLoading(true);
    setInlineError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');

      const pairs = notifications.map((n) => ({
        sourceId: n.lead_id,
        targetId: n.duplicate_of_lead_id,
        notificationId: n.notification_id,
      }));

      const response = await fetch('/api/leads/merge-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ pairs, strategy }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error ?? 'Erro ao processar mesclagem em lote');
      }

      const result = await response.json();
      const { total, succeeded, failed } = result as { total: number; succeeded: number; failed: number };

      onMergeComplete();
      onClose();

      if (succeeded === total) {
        toast.success(
          `${succeeded} lead${succeeded !== 1 ? 's' : ''} mesclado${succeeded !== 1 ? 's' : ''} com sucesso.`
        );
      } else if (succeeded > 0) {
        toast(
          `${succeeded} de ${total} merges realizados. ${failed} não ${failed !== 1 ? 'foram processados' : 'foi processado'}.`,
          { icon: '⚠️' }
        );
      } else {
        toast.error('Nenhum merge foi realizado. Verifique suas permissões.');
      }

    } catch (err) {
      // Erro inesperado (rede, HTTP 500, sessão) — modal permanece aberto
      setInlineError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setInlineError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Merge className="w-6 h-6 text-blue-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Mesclar em Lote</h2>
              <p className="text-sm text-gray-600">
                {count} par{count !== 1 ? 'es' : ''} selecionado{count !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Erro inesperado (HTTP 500, rede) — inline, modal permanece aberto */}
          {inlineError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center text-red-800">
                <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0" />
                <span className="text-sm">{inlineError}</span>
              </div>
            </div>
          )}

          {/* Aviso de irreversibilidade */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start text-amber-800">
              <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
              <p className="text-sm">
                Esta operação é <strong>irreversível</strong>. Os leads descartados serão arquivados e seus dados transferidos para o lead sobrevivente.
              </p>
            </div>
          </div>

          {/* Seleção de estratégia — mesmas opções do DuplicateMergeModal */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">
              Escolha a estratégia de mesclagem:
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              A estratégia selecionada será aplicada a todos os {count} pares.
            </p>

            <div className="space-y-3">
              <label className="flex items-start p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="bulk-strategy"
                  value="keep_existing"
                  checked={strategy === 'keep_existing'}
                  onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
                  disabled={loading}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900">Manter Lead Existente</div>
                  <div className="text-sm text-gray-600">Manter apenas o lead existente e descartar o novo</div>
                </div>
              </label>

              <label className="flex items-start p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="bulk-strategy"
                  value="keep_new"
                  checked={strategy === 'keep_new'}
                  onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
                  disabled={loading}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900">Manter Lead Novo</div>
                  <div className="text-sm text-gray-600">Manter apenas o lead novo e arquivar o existente</div>
                </div>
              </label>

              <label className="flex items-start p-4 border-2 border-blue-200 bg-blue-50 rounded-lg cursor-pointer">
                <input
                  type="radio"
                  name="bulk-strategy"
                  value="merge_fields"
                  checked={strategy === 'merge_fields'}
                  onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
                  disabled={loading}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-blue-900">Combinar Informações (Recomendado)</div>
                  <div className="text-sm text-blue-700">Combinar informações dos dois leads</div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleMerge}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Processando...
              </>
            ) : (
              <>
                <Merge className="w-4 h-4 mr-2" />
                Confirmar Mesclagem
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
