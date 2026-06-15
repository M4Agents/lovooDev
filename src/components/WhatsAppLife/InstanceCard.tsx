// =====================================================
// INSTANCE CARD — card de instância WhatsApp
// Extraído de WhatsAppLifeModule.tsx para manter o
// módulo dentro dos limites de tamanho.
// =====================================================

import React, { useState } from 'react';
import { User, Edit2, Trash2, AlertCircle } from 'lucide-react';
import { WhatsAppLifeInstance } from '../../types/whatsapp-life';
import { InstanceAvatar } from './InstanceAvatar';
import { UserSelector } from '../WhatsAppChat/UserSelector';

// =====================================================
// TIPOS
// =====================================================

interface InstanceCardProps {
  instance: WhatsAppLifeInstance;
  companyUsers: any[];
  loadingUsers: boolean;
  canManageWhatsAppAssignedUser: boolean;
  onAssignedUserChange: (
    instanceId: string,
    assignedUserId: string | null
  ) => Promise<{ success: boolean; error?: string }>;
  onSyncProfile: (instance: WhatsAppLifeInstance) => void;
  onEdit: (instance: WhatsAppLifeInstance) => void;
  onDelete: (instance: WhatsAppLifeInstance) => void;
}

// =====================================================
// COMPONENTE
// =====================================================

export const InstanceCard: React.FC<InstanceCardProps> = ({
  instance,
  companyUsers,
  loadingUsers,
  canManageWhatsAppAssignedUser,
  onAssignedUserChange,
  onSyncProfile,
  onEdit,
  onDelete,
}) => {
  const [isSaving, setIsSaving]           = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const handleAssignedUserSelect = async (userId: string) => {
    const assignedUserId = userId === '' ? null : userId;
    setIsSaving(true);
    setAssignmentError(null);

    const result = await onAssignedUserChange(instance.id, assignedUserId);

    setIsSaving(false);
    if (!result.success) {
      setAssignmentError(result.error || 'Erro ao atualizar responsável');
    }
  };

  return (
    <div className="border rounded-lg p-4 hover:bg-gray-50">
      {/* Linha principal: avatar + info + status + botões */}
      <div className="flex items-center justify-between">
        {/* Lado esquerdo: avatar e dados da instância */}
        <div className="flex items-center gap-3">
          <InstanceAvatar
            profilePictureUrl={instance.profile_picture_url}
            profileName={instance.profile_name}
            instanceName={instance.instance_name}
            status={instance.status}
            size="md"
          />
          <div>
            <h4 className="font-medium text-gray-900">{instance.instance_name}</h4>
            <p className="text-sm text-gray-600">
              {instance.profile_name || 'Perfil não disponível'}
            </p>
            {instance.phone_number && (
              <p className="text-xs text-gray-500">{instance.phone_number}</p>
            )}
          </div>
        </div>

        {/* Lado direito: status + botões */}
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              instance.status === 'connected' ? 'bg-green-100 text-green-800' :
              instance.status === 'connecting' ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {instance.status === 'connected' ? 'Conectado' :
               instance.status === 'connecting' ? 'Conectando' : 'Desconectado'}
            </span>

            {/* Badge de restrição WhatsApp — separado do status de conexão */}
            {(instance as any).restriction_key && (
              <div className="mt-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Restrição temporária de envio
                </span>
                {(instance as any).restriction_since && (
                  <p className="text-xs text-orange-600 mt-0.5">
                    Desde {new Date((instance as any).restriction_since).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                    })}
                  </p>
                )}
              </div>
            )}

            {instance.connected_at && (
              <p className="text-xs text-gray-500 mt-1">
                Conectado em {(() => {
                  const date = new Date(instance.connected_at!);
                  // Ajustar para horário de São Paulo (UTC-3)
                  const saoPauloTime = new Date(date.getTime() - (3 * 60 * 60 * 1000));
                  return saoPauloTime.toLocaleString('pt-BR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  });
                })()}
              </p>
            )}
          </div>

          {/* Botões de ação */}
          <div className="flex gap-1 ml-2">
            <button
              onClick={() => onSyncProfile(instance)}
              className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded"
              title="Sincronizar foto do perfil"
            >
              <User className="h-4 w-4" />
            </button>
            <button
              onClick={() => onEdit(instance)}
              className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
              title="Alterar nome"
            >
              <Edit2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => onDelete(instance)}
              className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
              title="Excluir instância"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Linha de responsável — apenas para admin/manager e acima */}
      {canManageWhatsAppAssignedUser && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 flex-shrink-0">
              Responsável
            </span>
            <div className="flex-1">
              <UserSelector
                users={companyUsers}
                selectedUser={instance.assigned_user_id ?? ''}
                onSelectUser={handleAssignedUserSelect}
                showNoneOption={true}
                disabled={isSaving || loadingUsers}
              />
              {assignmentError && (
                <p className="mt-1 text-xs text-red-600">{assignmentError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
