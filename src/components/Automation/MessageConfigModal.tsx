// =====================================================
// COMPONENT: MESSAGE CONFIG MODAL
// Data: 15/03/2026
// Objetivo: Modal de configuração de mensagem (estilo Datacraz)
// =====================================================

import { useState, useEffect } from 'react'
import { ArrowLeft, X, Settings } from 'lucide-react'
import MessageTypeSelector, { MessageType } from './MessageTypeSelector'
import MessageTextForm from './forms/MessageTextForm'
import UserInputForm from './forms/UserInputForm'
import DelayForm from './forms/DelayForm'
import AudioMessageForm from './forms/AudioMessageForm'
import FileAttachmentForm from './forms/FileAttachmentForm'
import DynamicUrlForm from './forms/DynamicUrlForm'
import { useAuth } from '../../contexts/AuthContext'
import { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances'

interface MessageConfigModalProps {
  isOpen: boolean
  onClose: () => void
  config: any
  onSave: (config: any) => void
}

export default function MessageConfigModal({ isOpen, onClose, config, onSave }: MessageConfigModalProps) {
  const { company } = useAuth()
  const { instances, loading: loadingInstances } = useWhatsAppInstances(company?.id)
  const [selectedType, setSelectedType] = useState<MessageType['id'] | null>(config.messageType || null)
  const [currentConfig, setCurrentConfig] = useState(config)
  const [selectedInstance, setSelectedInstance] = useState(config.instance || '')

  // Resetar estado quando modal abrir ou config mudar
  useEffect(() => {
    if (isOpen) {
      console.log('🔄 MessageConfigModal RESETANDO:', config)
      setCurrentConfig(config)
      setSelectedType(config.messageType || null)
      setSelectedInstance(config.instance || '')
    }
  }, [isOpen, config])

  if (!isOpen) return null

  const handleBack = () => {
    setSelectedType(null)
  }

  const handleSelectType = (typeId: MessageType['id']) => {
    setSelectedType(typeId)
    setCurrentConfig({ ...currentConfig, messageType: typeId })
  }

  const handleConfigChange = (newConfig: any) => {
    setCurrentConfig({ ...currentConfig, ...newConfig })
  }

  const handleSave = () => {
    const configToSave = { ...currentConfig, instance: selectedInstance }
    console.log('💾 MessageConfigModal SALVANDO:', {
      messageType: configToSave.messageType,
      duration: configToSave.duration,
      unit: configToSave.unit,
      fullConfig: configToSave
    })
    onSave(configToSave)
    onClose()
  }

  const renderForm = () => {
    switch (selectedType) {
      case 'text':
        return <MessageTextForm config={currentConfig} onChange={handleConfigChange} />
      case 'user_input':
        return <UserInputForm config={currentConfig} onChange={handleConfigChange} />
      case 'delay':
        return <DelayForm config={currentConfig} onChange={handleConfigChange} />
      case 'audio':
        return <AudioMessageForm config={currentConfig} onChange={handleConfigChange} />
      case 'file':
        return <FileAttachmentForm config={currentConfig} onChange={handleConfigChange} companyId={company?.id || ''} />
      case 'dynamic_url':
        return <DynamicUrlForm config={currentConfig} onChange={handleConfigChange} />
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-end">
      <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {selectedType && (
                <button
                  onClick={handleBack}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <ArrowLeft className="w-5 h-5 text-gray-600" />
                </button>
              )}
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Mensagens</h2>
                <p className="text-sm text-gray-600">Envie, receba e armazene respostas</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Conexão */}
        <div className="px-6 py-4 border-b border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Conexão
          </label>
          <div className="flex gap-2">
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loadingInstances}
            >
              <option value="">Selecionar</option>
              {instances
                .filter(instance => instance.status === 'connected')
                .map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.instance_name} {instance.phone_number ? `(${instance.phone_number})` : ''}
                  </option>
                ))}
            </select>
            <button className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              <Settings className="w-5 h-5 text-gray-600" />
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {loadingInstances ? (
              'Carregando instâncias...'
            ) : instances.filter(i => i.status === 'connected').length === 0 ? (
              'Nenhuma instância conectada disponível'
            ) : (
              'Deixe em branco para usar a conexão dos blocos anteriores'
            )}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!selectedType ? (
            <MessageTypeSelector onSelectType={handleSelectType} />
          ) : (
            renderForm()
          )}
        </div>

        {/* Footer */}
        {selectedType && (
          <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Salvar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
