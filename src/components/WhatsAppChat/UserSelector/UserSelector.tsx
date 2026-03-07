// =====================================================
// COMPONENTE: UserSelector
// Data: 07/03/2026
// Objetivo: Dropdown customizado para seleção de usuário responsável
// Padrão visual idêntico ao InstanceSelector
// =====================================================

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, User } from 'lucide-react'

interface CompanyUser {
  id: string
  display_name?: string
  email: string
  avatar_url?: string
}

interface UserSelectorProps {
  users: CompanyUser[]
  selectedUser?: string
  onSelectUser: (userId: string) => void
  showNoneOption?: boolean
  className?: string
  disabled?: boolean
}

export const UserSelector: React.FC<UserSelectorProps> = ({
  users,
  selectedUser,
  onSelectUser,
  showNoneOption = true,
  className = '',
  disabled = false
}) => {
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

  // Obter usuário selecionado
  const getSelectedUser = () => {
    if (!selectedUser) return null
    return users.find(u => u.id === selectedUser)
  }

  const selectedUserData = getSelectedUser()

  // Handler de seleção
  const handleSelect = (userId: string) => {
    onSelectUser(userId)
    setIsOpen(false)
  }

  // Gerar avatar com inicial do nome
  const UserAvatar: React.FC<{ user: CompanyUser; size?: 'sm' | 'md' }> = ({ user, size = 'md' }) => {
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-base'
    const initial = (user.display_name || user.email).charAt(0).toUpperCase()
    
    return (
      <div className={`${sizeClasses} rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold flex-shrink-0`}>
        {initial}
      </div>
    )
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Botão Principal */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full px-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl hover:bg-white hover:border-blue-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200 flex items-center justify-between ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {selectedUserData ? (
            <>
              <UserAvatar user={selectedUserData} size="md" />
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900 truncate">
                  {selectedUserData.display_name || selectedUserData.email}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-gray-500">Sem responsável</p>
              </div>
            </>
          )}
        </div>
        <ChevronDown 
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-200 z-50 max-h-96 overflow-y-auto">
          {/* Opção "Sem responsável" */}
          {showNoneOption && (
            <button
              onClick={() => handleSelect('')}
              className={`
                w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors
                ${!selectedUser ? 'bg-blue-50' : ''}
              `}
            >
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900">
                  Sem responsável
                </p>
              </div>
              {!selectedUser && (
                <Check className="w-5 h-5 text-blue-600 flex-shrink-0" />
              )}
            </button>
          )}

          {/* Divisor */}
          {showNoneOption && users.length > 0 && (
            <div className="border-t border-gray-100" />
          )}

          {/* Lista de Usuários */}
          {users.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              Nenhum usuário disponível
            </div>
          ) : (
            users.map((user) => (
              <button
                key={user.id}
                onClick={() => handleSelect(user.id)}
                className={`
                  w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors
                  ${selectedUser === user.id ? 'bg-blue-50' : ''}
                `}
              >
                <UserAvatar user={user} size="md" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-medium text-gray-900 truncate">
                    {user.display_name || user.email}
                  </p>
                </div>
                {selectedUser === user.id && (
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
