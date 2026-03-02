// =====================================================
// INSTANCE AVATAR - COMPONENTE DE AVATAR WHATSAPP
// =====================================================
// Exibe foto de perfil das instâncias WhatsApp com fallbacks

import React, { useState } from 'react';

interface InstanceAvatarProps {
  profilePictureUrl?: string | null;
  profileName?: string | null;
  instanceName: string;
  size?: 'sm' | 'md' | 'lg';
  status: 'connected' | 'connecting' | 'disconnected' | 'error' | 'qr_pending';
  className?: string;
  showStatus?: boolean;
}

export const InstanceAvatar: React.FC<InstanceAvatarProps> = ({
  profilePictureUrl,
  profileName,
  instanceName,
  size = 'md',
  status,
  className = '',
  showStatus = true
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  // Configurações de tamanho
  const sizeClasses = {
    sm: {
      container: 'w-8 h-8',
      text: 'text-xs',
      status: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5'
    },
    md: {
      container: 'w-12 h-12',
      text: 'text-sm',
      status: 'w-3 h-3 -bottom-0.5 -right-0.5'
    },
    lg: {
      container: 'w-16 h-16',
      text: 'text-base',
      status: 'w-4 h-4 -bottom-1 -right-1'
    }
  };

  // Cores do status
  const statusColors = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-red-500',
    error: 'bg-red-600',
    qr_pending: 'bg-blue-500'
  };

  // Gerar iniciais do nome
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .slice(0, 2)
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase();
  };

  // Nome para exibição e iniciais
  const displayName = profileName || instanceName;
  const initials = getInitials(displayName);

  // Verificar se deve mostrar imagem
  const shouldShowImage = profilePictureUrl && !imageError && profilePictureUrl.trim() !== '';

  // Handler para erro na imagem
  const handleImageError = () => {
    setImageError(true);
    setImageLoading(false);
  };

  // Handler para sucesso no carregamento
  const handleImageLoad = () => {
    setImageLoading(false);
  };

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Container do Avatar */}
      <div className={`
        ${sizeClasses[size].container}
        rounded-full
        flex items-center justify-center
        overflow-hidden
        bg-gradient-to-br from-blue-100 to-purple-100
        border-2 border-white
        shadow-sm
        relative
      `}>
        {shouldShowImage ? (
          <>
            {/* Loading spinner */}
            {imageLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
              </div>
            )}
            
            {/* Imagem do perfil */}
            <img 
              src={profilePictureUrl}
              alt={`Avatar de ${displayName}`}
              className={`
                w-full h-full object-cover
                ${imageLoading ? 'opacity-0' : 'opacity-100'}
                transition-opacity duration-200
              `}
              onError={handleImageError}
              onLoad={handleImageLoad}
              loading="lazy"
            />
          </>
        ) : (
          /* Fallback com iniciais */
          <div className={`
            w-full h-full
            flex items-center justify-center
            bg-gradient-to-br from-blue-500 to-purple-600
            text-white font-semibold
            ${sizeClasses[size].text}
          `}>
            {initials}
          </div>
        )}
      </div>

      {/* Indicador de Status */}
      {showStatus && (
        <div 
          className={`
            absolute rounded-full
            ${sizeClasses[size].status}
            ${statusColors[status]}
            border-2 border-white
            shadow-sm
          `}
          title={`Status: ${status === 'connected' ? 'Conectado' : 
                           status === 'connecting' ? 'Conectando' : 
                           status === 'qr_pending' ? 'Aguardando QR' :
                           status === 'error' ? 'Erro' : 'Desconectado'}`}
        />
      )}
    </div>
  );
};

// =====================================================
// COMPONENTE DE AVATAR COM SINCRONIZAÇÃO
// =====================================================
// Versão com botão de sincronização integrado

interface InstanceAvatarWithSyncProps extends InstanceAvatarProps {
  onSyncProfile?: () => void;
  syncLoading?: boolean;
  showSyncButton?: boolean;
}

export const InstanceAvatarWithSync: React.FC<InstanceAvatarWithSyncProps> = ({
  onSyncProfile,
  syncLoading = false,
  showSyncButton = false,
  ...avatarProps
}) => {
  return (
    <div className="relative group">
      <InstanceAvatar {...avatarProps} />
      
      {/* Botão de sincronização */}
      {showSyncButton && onSyncProfile && (
        <button
          onClick={onSyncProfile}
          disabled={syncLoading}
          className={`
            absolute -top-1 -right-1
            w-6 h-6 rounded-full
            bg-blue-600 hover:bg-blue-700
            text-white text-xs
            flex items-center justify-center
            opacity-0 group-hover:opacity-100
            transition-all duration-200
            shadow-sm border-2 border-white
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
          title="Sincronizar foto do perfil"
        >
          {syncLoading ? (
            <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent"></div>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
};
