// =====================================================
// COMPONENTE: InstanceSelector
// Data: 06/03/2026
// Objetivo: Dropdown customizado para seleção de instância WhatsApp
// =====================================================

import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Check } from 'lucide-react'
import { InstanceAvatar } from './InstanceAvatar'
import type { WhatsAppProvider } from '../../../types/meta-whatsapp'

interface WhatsAppInstance {
  id: string
  instance_name: string
  phone_number?: string
  profile_name?: string
  profile_picture_url?: string
  status: string
  assigned_user_id?: string | null
  available_to_all?: boolean | null
  /** Identifica o provider da instância para badge visual.
   *  undefined = Uazapi (comportamento legado, sem badge). */
  provider?: WhatsAppProvider
}

interface InstanceSelectorProps {
  instances: WhatsAppInstance[]
  selectedInstance?: string
  /** provider é repassado explicitamente — elimina lookup no handler do consumidor */
  onSelectInstance: (id: string, provider?: WhatsAppProvider) => void
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

  // Handler de seleção — provider viaja explicitamente para eliminar lookup no consumidor
  const handleSelect = (id: string, provider?: WhatsAppProvider) => {
    onSelectInstance(id, provider)
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Botão Principal */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-1 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-lg hover:bg-white hover:border-blue-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200 flex items-center justify-between"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedInstance === 'all' ? (
            <>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
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
                size="sm"
              />
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {selectedInstanceData.profile_name || selectedInstanceData.instance_name}
                  </p>
                  {selectedInstanceData.provider === 'meta' && (
                    <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 leading-none">
                      META
                    </span>
                  )}
                </div>
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
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-50 max-h-96 overflow-y-auto">
          {/* Opção "Todas" — provider undefined (não é Uazapi nem Meta) */}
          {showAllOption && (
            <button
              onClick={() => handleSelect('all', undefined)}
              className={`
                w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors
                ${selectedInstance === 'all' ? 'bg-blue-50' : ''}
              `}
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
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
            <div className="px-4 py-6 text-center text-gray-500 text-sm">
              {t('instanceSelector.empty')}
            </div>
          ) : (
            instances.map((instance) => (
              <button
                key={instance.id}
                onClick={() => handleSelect(instance.id, instance.provider)}
                className={`
                  w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors
                  ${selectedInstance === instance.id ? 'bg-blue-50' : ''}
                `}
              >
                <InstanceAvatar
                  profilePictureUrl={instance.profile_picture_url}
                  profileName={instance.profile_name}
                  instanceName={instance.instance_name}
                  size="sm"
                />
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {instance.profile_name || instance.instance_name}
                    </p>
                    {instance.provider === 'meta' && (
                      <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 leading-none">
                        META
                      </span>
                    )}
                  </div>
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
