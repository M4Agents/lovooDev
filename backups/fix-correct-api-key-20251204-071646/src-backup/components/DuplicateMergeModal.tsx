import React, { useState } from 'react';
import { X, Users, Mail, Phone, Calendar, Merge, AlertTriangle } from 'lucide-react';

interface DuplicateNotification {
  notification_id: number;
  lead_id: number;
  lead_name: string;
  lead_email: string;
  lead_phone: string;
  duplicate_of_lead_id: number;
  duplicate_name: string;
  duplicate_email: string;
  duplicate_phone: string;
  reason: 'phone' | 'email';
  created_at: string;
}

interface DuplicateMergeModalProps {
  notification: DuplicateNotification;
  onClose: () => void;
  onMergeComplete?: () => void;
}

type MergeStrategy = 'keep_existing' | 'keep_new' | 'merge_fields';

export const DuplicateMergeModal: React.FC<DuplicateMergeModalProps> = ({
  notification,
  onClose,
  onMergeComplete
}) => {
  const [strategy, setStrategy] = useState<MergeStrategy>('merge_fields');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMerge = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('Iniciando mesclagem de leads...');

      // Chamar API de mesclagem
      const mergeResponse = await fetch('/api/leads/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sourceId: notification.lead_id,
          targetId: notification.duplicate_of_lead_id,
          strategy,
          notificationId: notification.notification_id
        })
      });

      if (!mergeResponse.ok) {
        const errorData = await mergeResponse.json();
        throw new Error(errorData.error || 'Erro ao mesclar leads');
      }

      const mergeResult = await mergeResponse.json();
      console.log('Mesclagem concluída:', mergeResult);

      if (onMergeComplete) {
        onMergeComplete();
      }
      
      onClose();
    } catch (err) {
      console.error('Erro na mesclagem:', err);
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const getStrategyDescription = (strategy: MergeStrategy) => {
    switch (strategy) {
      case 'keep_existing':
        return 'Manter apenas o lead existente e descartar o novo';
      case 'keep_new':
        return 'Manter apenas o lead novo e arquivar o existente';
      case 'merge_fields':
        return 'Combinar informações dos dois leads (recomendado)';
      default:
        return '';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Merge className="w-6 h-6 text-blue-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Mesclar Leads Duplicados</h2>
              <p className="text-sm text-gray-600">
                Duplicata detectada por {notification.reason === 'phone' ? 'telefone' : 'email'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center text-red-800">
                <AlertTriangle className="w-5 h-5 mr-2" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Comparação de Leads */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Lead Novo */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center mb-4">
                <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                <h3 className="font-semibold text-blue-900">Lead Novo (ID: {notification.lead_id})</h3>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-start">
                  <Users className="w-4 h-4 text-blue-600 mr-2 mt-0.5" />
                  <div>
                    <div className="text-sm text-blue-800 font-medium">Nome</div>
                    <div className="text-blue-900">{notification.lead_name}</div>
                  </div>
                </div>

                {notification.lead_email && (
                  <div className="flex items-start">
                    <Mail className="w-4 h-4 text-blue-600 mr-2 mt-0.5" />
                    <div>
                      <div className="text-sm text-blue-800 font-medium">Email</div>
                      <div className="text-blue-900">{notification.lead_email}</div>
                    </div>
                  </div>
                )}

                {notification.lead_phone && (
                  <div className="flex items-start">
                    <Phone className="w-4 h-4 text-blue-600 mr-2 mt-0.5" />
                    <div>
                      <div className="text-sm text-blue-800 font-medium">Telefone</div>
                      <div className="text-blue-900">{notification.lead_phone}</div>
                    </div>
                  </div>
                )}

                <div className="flex items-start">
                  <Calendar className="w-4 h-4 text-blue-600 mr-2 mt-0.5" />
                  <div>
                    <div className="text-sm text-blue-800 font-medium">Criado em</div>
                    <div className="text-blue-900">{formatDate(notification.created_at)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Lead Existente */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center mb-4">
                <div className="w-3 h-3 bg-gray-500 rounded-full mr-2"></div>
                <h3 className="font-semibold text-gray-900">Lead Existente (ID: {notification.duplicate_of_lead_id})</h3>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-start">
                  <Users className="w-4 h-4 text-gray-600 mr-2 mt-0.5" />
                  <div>
                    <div className="text-sm text-gray-600 font-medium">Nome</div>
                    <div className="text-gray-900">{notification.duplicate_name}</div>
                  </div>
                </div>

                {notification.duplicate_email && (
                  <div className="flex items-start">
                    <Mail className="w-4 h-4 text-gray-600 mr-2 mt-0.5" />
                    <div>
                      <div className="text-sm text-gray-600 font-medium">Email</div>
                      <div className="text-gray-900">{notification.duplicate_email}</div>
                    </div>
                  </div>
                )}

                {notification.duplicate_phone && (
                  <div className="flex items-start">
                    <Phone className="w-4 h-4 text-gray-600 mr-2 mt-0.5" />
                    <div>
                      <div className="text-sm text-gray-600 font-medium">Telefone</div>
                      <div className="text-gray-900">{notification.duplicate_phone}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Estratégias de Mesclagem */}
          <div className="mb-6">
            <h4 className="font-semibold text-gray-900 mb-4">Escolha a estratégia de mesclagem:</h4>
            
            <div className="space-y-3">
              <label className="flex items-start p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="strategy"
                  value="keep_existing"
                  checked={strategy === 'keep_existing'}
                  onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900">Manter Lead Existente</div>
                  <div className="text-sm text-gray-600">{getStrategyDescription('keep_existing')}</div>
                </div>
              </label>

              <label className="flex items-start p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="strategy"
                  value="keep_new"
                  checked={strategy === 'keep_new'}
                  onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900">Manter Lead Novo</div>
                  <div className="text-sm text-gray-600">{getStrategyDescription('keep_new')}</div>
                </div>
              </label>

              <label className="flex items-start p-4 border-2 border-blue-200 bg-blue-50 rounded-lg cursor-pointer">
                <input
                  type="radio"
                  name="strategy"
                  value="merge_fields"
                  checked={strategy === 'merge_fields'}
                  onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-blue-900">Combinar Informações (Recomendado)</div>
                  <div className="text-sm text-blue-700">{getStrategyDescription('merge_fields')}</div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
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
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
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
