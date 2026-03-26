import React, { useState } from 'react'
import { AlertCircle, RefreshCw, ArrowRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { QRCodeModal } from '../../WhatsAppLife/QRCodeModal'
import { useWhatsAppInstancesWebhook100 } from '../../../hooks/useWhatsAppInstances_webhook100'

interface InstanceAlertProps {
  conversationId: string
  instanceId?: string
  instanceName?: string
  instanceStatus?: string
  instanceDeleted?: boolean
  companyId: string
  userId: string
  onMigrationComplete?: () => void
}

export const InstanceAlert: React.FC<InstanceAlertProps> = ({
  conversationId,
  instanceId,
  instanceName,
  instanceStatus,
  instanceDeleted,
  companyId,
  userId,
  onMigrationComplete
}) => {
  const [showMigrationModal, setShowMigrationModal] = useState(false)
  const [availableInstances, setAvailableInstances] = useState<any[]>([])
  const [selectedInstance, setSelectedInstance] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  
  // Estados para QR Code Modal
  const [showQRModal, setShowQRModal] = useState(false)
  const [qrCodeData, setQrCodeData] = useState<any>(null)
  
  // Hook para reconexão de instância
  const { reconnectInstance, getQRCode } = useWhatsAppInstancesWebhook100(companyId)

  // Não mostrar alerta se instância está conectada
  if (instanceStatus === 'connected' && !instanceDeleted) {
    return null
  }

  const handleReconnect = async () => {
    if (!instanceId) {
      setError('ID da instância não encontrado')
      return
    }
    
    setShowQRModal(true)
    setQrCodeData({ status: 'loading' })
    
    try {
      const result = await reconnectInstance(instanceId)
      
      if (result.success && result.data) {
        setQrCodeData(result.data)
      } else {
        setQrCodeData({ 
          error_message: result.error || 'Erro ao gerar QR Code para reconexão' 
        })
      }
    } catch (err: any) {
      setQrCodeData({ 
        error_message: err.message || 'Erro ao reconectar instância' 
      })
    }
  }

  const handleOpenMigration = async () => {
    setLoading(true)
    setError('')
    
    try {
      // Buscar instâncias ativas
      const { data, error } = await supabase
        .from('whatsapp_life_instances')
        .select('id, instance_name, status, phone_number')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .eq('status', 'connected')
        .order('instance_name')
      
      if (error) throw error
      
      setAvailableInstances(data || [])
      setShowMigrationModal(true)
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar instâncias')
    } finally {
      setLoading(false)
    }
  }

  const handleMigrate = async () => {
    if (!selectedInstance) {
      setError('Selecione uma instância')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data, error } = await supabase.rpc('migrate_conversation_to_instance', {
        p_conversation_id: conversationId,
        p_new_instance_id: selectedInstance,
        p_company_id: companyId,
        p_user_id: userId,
        p_reason: 'Migração manual via interface'
      })

      if (error) throw error

      if (data?.success) {
        setShowMigrationModal(false)
        onMigrationComplete?.()
      } else {
        throw new Error(data?.error || 'Erro ao migrar conversa')
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao migrar conversa')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4 rounded-r-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-yellow-800 mb-1">
              {instanceDeleted ? 'Instância Deletada' : 'Instância Desconectada'}
            </h3>
            <p className="text-sm text-yellow-700 mb-3">
              {instanceDeleted ? (
                <>
                  Esta conversa foi iniciada pela instância <strong>"{instanceName}"</strong> que foi deletada.
                  Você pode migrar esta conversa para outra instância ativa para continuar o atendimento.
                </>
              ) : (
                <>
                  Esta conversa foi iniciada pela instância <strong>"{instanceName}"</strong> que está desconectada.
                  Reconecte a instância ou migre esta conversa para outra instância ativa.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {!instanceDeleted && (
                <button
                  onClick={handleReconnect}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-600 text-white text-sm font-medium rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reconectar Instância
                </button>
              )}
              <button
                onClick={handleOpenMigration}
                disabled={loading}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-yellow-800 text-sm font-medium rounded-lg border border-yellow-300 hover:bg-yellow-50 transition-colors disabled:opacity-50"
              >
                <ArrowRight className="w-4 h-4" />
                {loading ? 'Carregando...' : 'Migrar para Outra Instância'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de QR Code para Reconexão */}
      {showQRModal && (
        <QRCodeModal
          isOpen={showQRModal}
          onClose={() => {
            setShowQRModal(false)
            setQrCodeData(null)
            // Atualizar conversa após reconexão bem-sucedida
            onMigrationComplete?.()
          }}
          instanceId={instanceId || ''}
          instanceName={instanceName || 'Instância'}
          onGetQRCode={getQRCode}
          qrCodeData={qrCodeData}
        />
      )}

      {/* Modal de Migração */}
      {showMigrationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Migrar Conversa
            </h3>
            
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selecione a nova instância:
              </label>
              <select
                value={selectedInstance}
                onChange={(e) => setSelectedInstance(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Selecione...</option>
                {availableInstances.map(inst => (
                  <option key={inst.id} value={inst.id}>
                    {inst.instance_name} ({inst.phone_number || 'Sem telefone'})
                  </option>
                ))}
              </select>
              {availableInstances.length === 0 && (
                <p className="mt-2 text-sm text-gray-500">
                  Nenhuma instância conectada disponível
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowMigrationModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleMigrate}
                disabled={loading || !selectedInstance}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Migrando...' : 'Migrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
