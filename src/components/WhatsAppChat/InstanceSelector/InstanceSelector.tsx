// =====================================================
// COMPONENTE: InstanceSelector
// Data: 06/03/2026
// Objetivo: Dropdown customizado para seleção de instância WhatsApp
// =====================================================

import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Check } from 'lucide-react'
import { InstanceAvatar } from './InstanceAvatar'

interface WhatsAppInstance {
  id: string
  instance_name: string
  phone_number?: string
  profile_name?: string
  profile_picture_url?: string
  status: string
}

interface InstanceSelectorProps {
  instances: WhatsAppInstance[]
  selectedInstance?: string
  onSelectInstance: (id: string) => void
  showAllOption?: boolean
  conversationCount?: number
  className?: string
}

export const InstanceSelector: React.FC<InstanceSelectorProps> = ({
  instances,
  selectedInstance,
  onSelectInstance,
  showAllOption = true,
  conversationCount = 0,
  className = ''
}) => {
  const { t } = useTranslation('chat')
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Obter instância selecionada
  const getSelectedInstance = () => {
    if (selectedInstance === 'all') {
      return null
    }
    return instances.find(i => i.id === selectedInstance)
  }

  const selectedInstanceData = getSelectedInstance()

  // Handler de seleção
  const handleSelect = (id: string) => {
    onSelectInstance(id)
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Botão Principal */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl hover:bg-white hover:border-blue-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200 flex items-center justify-between"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {selectedInstance === 'all' ? (
            <>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                📱
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900 truncate">
                  {t('instanceSelector.allInstances')}
                </p>
                <p className="text-xs text-gray-500">
                  {t('instanceSelector.conversationsCount', { count: conversationCount })}
                </p>
              </div>
            </>
          ) : selectedInstanceData ? (
            <>
              <InstanceAvatar
                profilePictureUrl={selectedInstanceData.profile_picture_url}
                profileName={selectedInstanceData.profile_name}
                instanceName={selectedInstanceData.instance_name}
                size="md"
              />
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900 truncate">
                  {selectedInstanceData.profile_name || selectedInstanceData.instance_name}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {selectedInstanceData.phone_number || selectedInstanceData.instance_name}
                </p>
              </div>
            </>
          ) : (
            <p className="text-gray-500">{t('instanceSelector.selectPlaceholder')}</p>
          )}
        </div>
        <ChevronDown 
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-200 z-50 max-h-96 overflow-y-auto">
          {/* Opção "Todas" */}
          {showAllOption && (
            <button
              onClick={() => handleSelect('all')}
              className={`
                w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors
                ${selectedInstance === 'all' ? 'bg-blue-50' : ''}
              `}
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                📱
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900">
                  {t('instanceSelector.allInstances')}
                </p>
                <p className="text-xs text-gray-500">
                  {t('instanceSelector.conversationsCount', { count: conversationCount })}
                </p>
              </div>
              {selectedInstance === 'all' && (
                <Check className="w-5 h-5 text-blue-600 flex-shrink-0" />
              )}
            </button>
          )}

          {/* Divisor */}
          {showAllOption && instances.length > 0 && (
            <div className="border-t border-gray-100" />
          )}

          {/* Lista de Instâncias */}
          {instances.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              {t('instanceSelector.empty')}
            </div>
          ) : (
            instances.map((instance) => (
              <button
                key={instance.id}
                onClick={() => handleSelect(instance.id)}
                className={`
                  w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors
                  ${selectedInstance === instance.id ? 'bg-blue-50' : ''}
                `}
              >
                <InstanceAvatar
                  profilePictureUrl={instance.profile_picture_url}
                  profileName={instance.profile_name}
                  instanceName={instance.instance_name}
                  size="md"
                />
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-medium text-gray-900 truncate">
                    {instance.profile_name || instance.instance_name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {instance.phone_number || instance.instance_name}
                  </p>
                </div>
                {selectedInstance === instance.id && (
                  <Check className="w-5 h-5 text-blue-600 flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
