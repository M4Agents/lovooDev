import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Settings, ArrowRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

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
  const { t } = useTranslation('chat')
  const [showMigrationModal, setShowMigrationModal] = useState(false)
  const [availableInstances, setAvailableInstances] = useState<any[]>([])
  const [selectedInstance, setSelectedInstance] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  // Não mostrar alerta se instância está conectada
  if (instanceStatus === 'connected' && !instanceDeleted) {
    return null
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
      setError(err.message || t('instanceAlert.errors.fetchInstances'))
    } finally {
      setLoading(false)
    }
  }

  const handleMigrate = async () => {
    if (!selectedInstance) {
      setError(t('instanceAlert.errors.selectInstance'))
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
        throw new Error(data?.error || t('instanceAlert.errors.migrateFailed'))
      }
    } catch (err: any) {
      setError(err.message || t('instanceAlert.errors.migrateFailed'))
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
              {instanceDeleted ? t('instanceAlert.titleDeleted') : t('instanceAlert.titleDisconnected')}
            </h3>
            <p className="text-sm text-yellow-700 mb-3">
              {instanceDeleted
                ? t('instanceAlert.bodyDeleted', { name: instanceName ?? '' })
                : t('instanceAlert.bodyDisconnected', { name: instanceName ?? '' })}
            </p>
            
            <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">
                📋 {t('instanceAlert.howToTitle')}
              </h4>
              <ol className="text-xs text-blue-800 space-y-1 ml-4 list-decimal">
                <li>{t('instanceAlert.step1')}</li>
                <li>{t('instanceAlert.step2')}</li>
                <li>{t('instanceAlert.step3')}</li>
                <li>{t('instanceAlert.step4')}</li>
                <li>{t('instanceAlert.step5')}</li>
                <li>{t('instanceAlert.step6')}</li>
              </ol>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => window.location.href = '/settings/integrations'}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Settings className="w-4 h-4" />
                {t('instanceAlert.goSettings')}
              </button>
              <button
                onClick={handleOpenMigration}
                disabled={loading}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-yellow-800 text-sm font-medium rounded-lg border border-yellow-300 hover:bg-yellow-50 transition-colors disabled:opacity-50"
              >
                <ArrowRight className="w-4 h-4" />
                {loading ? t('instanceAlert.migrateLoading') : t('instanceAlert.migrateButton')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Migração */}
      {showMigrationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {t('instanceAlert.modalTitle')}
            </h3>
            
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('instanceAlert.selectLabel')}
              </label>
              <select
                value={selectedInstance}
                onChange={(e) => setSelectedInstance(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{t('instanceAlert.selectPlaceholder')}</option>
                {availableInstances.map(inst => (
                  <option key={inst.id} value={inst.id}>
                    {inst.instance_name} ({inst.phone_number || t('instanceAlert.noPhone')})
                  </option>
                ))}
              </select>
              {availableInstances.length === 0 && (
                <p className="mt-2 text-sm text-gray-500">
                  {t('instanceAlert.noInstancesAvailable')}
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowMigrationModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {t('instanceAlert.cancel')}
              </button>
              <button
                onClick={handleMigrate}
                disabled={loading || !selectedInstance}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? t('instanceAlert.migrating') : t('instanceAlert.migrate')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
