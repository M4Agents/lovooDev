// =====================================================
// COMPONENT: MESSAGE CONFIG MODAL
// Data: 15/03/2026
// Objetivo: Modal de configuração de mensagem (estilo Datacraz)
// =====================================================

import { useState, useEffect } from 'react'
import { ArrowLeft, X, Settings, AlertCircle } from 'lucide-react'
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
  const [selectedInstance, setSelectedInstance] = useState(config.instanceId || '')
  const [validationError, setValidationError] = useState<string | null>(null)

  // Resetar estado quando modal abrir ou config mudar
  useEffect(() => {
    if (isOpen) {
      setCurrentConfig(config)
      setSelectedType(config.messageType || null)
      setSelectedInstance(config.instanceId || '')
      setValidationError(null)
    }
  }, [isOpen, config])

  if (!isOpen) return null

  const handleBack = () => {
    setSelectedType(null)
    setValidationError(null)
  }

  const handleSelectType = (typeId: MessageType['id']) => {
    setSelectedType(typeId)
    setCurrentConfig({ ...currentConfig, messageType: typeId })
    setValidationError(null)
  }

  const handleConfigChange = (newConfig: any) => {
    setCurrentConfig({ ...currentConfig, ...newConfig })
    setValidationError(null)
  }

  const validateConfig = (): string | null => {
    switch (selectedType) {
      case 'text':
        if (!currentConfig.message?.trim())
          return 'A mensagem não pode estar vazia.'
        break
      case 'user_input':
        if (!currentConfig.question?.trim())
          return 'A pergunta não pode estar vazia.'
        break
      case 'audio':
        if (!currentConfig.audioFile && !currentConfig.audioUrl?.trim())
          return 'Envie um arquivo de áudio ou informe uma URL.'
        break
      case 'file':
        if (!currentConfig.file && !currentConfig.fileUrl?.trim())
          return 'Envie um arquivo ou informe uma URL.'
        break
      case 'dynamic_url':
        if (!currentConfig.url?.trim())
          return 'A URL não pode estar vazia.'
        break
    }
    return null
  }

  const handleSave = () => {
    const error = validateConfig()
    if (error) {
      setValidationError(error)
      return
    }

    const selectedInstanceData = instances.find(inst => inst.id === selectedInstance)
    const configToSave = {
      ...currentConfig,
      instanceId: selectedInstance,
      instanceName: selectedInstanceData?.instance_name || ''
    }
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
        return <AudioMessageForm config={currentConfig} onChange={handleConfigChange} companyId={company?.id || ''} />
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
          <div className="px-6 py-4 border-t border-gray-200 space-y-3">
            {validationError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{validationError}</p>
              </div>
            )}
            <div className="flex gap-3">
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
          </div>
        )}
      </div>
    </div>
  )
}
