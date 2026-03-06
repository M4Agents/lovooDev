// =====================================================
// COMPONENTE: InstanceAvatar
// Data: 06/03/2026
// Objetivo: Avatar de instância WhatsApp com foto de perfil
// =====================================================

import { useState } from 'react'

interface InstanceAvatarProps {
  profilePictureUrl?: string
  profileName?: string
  instanceName: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export const InstanceAvatar: React.FC<InstanceAvatarProps> = ({
  profilePictureUrl,
  profileName,
  instanceName,
  size = 'md',
  className = ''
}) => {
  const [imageError, setImageError] = useState(false)

  // Tamanhos
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  }

  // Gerar iniciais do nome
  const getInitials = () => {
    if (profileName) {
      const names = profileName.trim().split(' ')
      if (names.length >= 2) {
        return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
      }
      return profileName.substring(0, 2).toUpperCase()
    }
    // Fallback para primeiros 2 dígitos do número
    return instanceName.substring(0, 2)
  }

  // Se tem foto e não deu erro, mostrar foto
  if (profilePictureUrl && !imageError) {
    return (
      <div className={`${sizeClasses[size]} rounded-full overflow-hidden flex-shrink-0 ${className}`}>
        <img
          src={profilePictureUrl}
          alt={profileName || instanceName}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
        />
      </div>
    )
  }

  // Fallback: Iniciais com gradiente
  return (
    <div 
      className={`
        ${sizeClasses[size]} 
        rounded-full 
        flex-shrink-0 
        flex 
        items-center 
        justify-center 
        font-semibold 
        text-white
        bg-gradient-to-br from-green-400 to-green-600
        ${className}
      `}
    >
      {getInitials()}
    </div>
  )
}
