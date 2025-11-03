import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AlertTriangle, Users, Phone, Mail, X, Check, Merge } from 'lucide-react';

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

interface DuplicateNotificationsProps {
  onMergeRequest?: (notification: DuplicateNotification) => void;
}

export const DuplicateNotifications: React.FC<DuplicateNotificationsProps> = ({ onMergeRequest }) => {
  const { company } = useAuth();
  const [notifications, setNotifications] = useState<DuplicateNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (company) {
      loadNotifications();
    }
  }, [company]);

  const loadNotifications = async () => {
    if (!company) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/leads/duplicate-notifications?company_id=${company.id}`, {
        headers: {
          'x-company-id': company.id
        }
      });

      if (!response.ok) {
        throw new Error('Erro ao carregar notificações');
      }

      const data = await response.json();
      setNotifications(data.notifications || []);
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const handleIgnoreNotification = async (notificationId: number) => {
    if (!company) return;

    try {
      const response = await fetch('/api/leads/duplicate-notifications', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-company-id': company.id
        },
        body: JSON.stringify({
          notification_id: notificationId,
          status: 'ignored'
        })
      });

      if (response.ok) {
        // Remover notificação da lista
        setNotifications(prev => prev.filter(n => n.notification_id !== notificationId));
      }
    } catch (err) {
      console.error('Erro ao ignorar notificação:', err);
    }
  };

  const handleMergeClick = (notification: DuplicateNotification) => {
    if (onMergeRequest) {
      onMergeRequest(notification);
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

  const getReasonIcon = (reason: string) => {
    return reason === 'phone' ? <Phone className="w-4 h-4" /> : <Mail className="w-4 h-4" />;
  };

  const getReasonText = (reason: string) => {
    return reason === 'phone' ? 'Telefone' : 'Email';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Carregando notificações...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center text-red-600">
          <AlertTriangle className="w-5 h-5 mr-2" />
          <span>Erro: {error}</span>
        </div>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center text-green-600">
          <Check className="w-5 h-5 mr-2" />
          <span>Nenhuma duplicata pendente</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <AlertTriangle className="w-6 h-6 text-orange-500 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Duplicatas Detectadas
              </h3>
              <p className="text-sm text-gray-600">
                {notifications.length} lead{notifications.length !== 1 ? 's' : ''} duplicado{notifications.length !== 1 ? 's' : ''} encontrado{notifications.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-200">
        {notifications.map((notification) => (
          <div key={notification.notification_id} className="p-6 hover:bg-gray-50 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center mb-3">
                  <Users className="w-5 h-5 text-gray-400 mr-2" />
                  <span className="text-sm font-medium text-gray-900">
                    Lead Duplicado Detectado
                  </span>
                  <div className="flex items-center ml-3 px-2 py-1 bg-orange-100 text-orange-800 rounded-full text-xs">
                    {getReasonIcon(notification.reason)}
                    <span className="ml-1">{getReasonText(notification.reason)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Lead Novo */}
                  <div className="bg-blue-50 rounded-lg p-4">
                    <h4 className="font-medium text-blue-900 mb-2">Lead Novo (ID: {notification.lead_id})</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center text-blue-800">
                        <Users className="w-4 h-4 mr-2" />
                        {notification.lead_name}
                      </div>
                      {notification.lead_email && (
                        <div className="flex items-center text-blue-700">
                          <Mail className="w-4 h-4 mr-2" />
                          {notification.lead_email}
                        </div>
                      )}
                      {notification.lead_phone && (
                        <div className="flex items-center text-blue-700">
                          <Phone className="w-4 h-4 mr-2" />
                          {notification.lead_phone}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Lead Existente */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 mb-2">Lead Existente (ID: {notification.duplicate_of_lead_id})</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center text-gray-800">
                        <Users className="w-4 h-4 mr-2" />
                        {notification.duplicate_name}
                      </div>
                      {notification.duplicate_email && (
                        <div className="flex items-center text-gray-700">
                          <Mail className="w-4 h-4 mr-2" />
                          {notification.duplicate_email}
                        </div>
                      )}
                      {notification.duplicate_phone && (
                        <div className="flex items-center text-gray-700">
                          <Phone className="w-4 h-4 mr-2" />
                          {notification.duplicate_phone}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-xs text-gray-500">
                  Detectado em: {formatDate(notification.created_at)}
                </div>
              </div>

              <div className="flex flex-col space-y-2 ml-4">
                <button
                  onClick={() => handleMergeClick(notification)}
                  className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
                  title="Mesclar leads"
                >
                  <Merge className="w-4 h-4 mr-1" />
                  Mesclar
                </button>
                
                <button
                  onClick={() => handleIgnoreNotification(notification.notification_id)}
                  className="flex items-center px-3 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors text-sm"
                  title="Ignorar duplicata"
                >
                  <X className="w-4 h-4 mr-1" />
                  Ignorar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
