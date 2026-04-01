import React from 'react';
import { User } from 'lucide-react';

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fallbackText?: string;
  className?: string;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-xl'
};

const iconSizes = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8'
};

export const Avatar: React.FC<AvatarProps> = ({ 
  src, 
  alt = 'Avatar', 
  size = 'md', 
  fallbackText,
  className = ''
}) => {
  const [imageError, setImageError] = React.useState(false);
  const [imageLoading, setImageLoading] = React.useState(true);

  React.useEffect(() => {
    setImageError(false);
    setImageLoading(!!src);
    // #region agent log
    const urlType = !src ? 'null' : src.includes('pps.whatsapp.net') || src.includes('mmg.whatsapp.net') ? 'CDN_WA' : src.includes('contact-avatars') ? 'STORAGE_OK' : src.includes('chat-media') ? 'STORAGE_BROKEN' : 'OTHER';
    fetch('http://127.0.0.1:7869/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'27238b'},body:JSON.stringify({sessionId:'27238b',location:'Avatar.tsx:src-changed',message:'Avatar src changed — loading reset',data:{urlType,src:src?src.substring(0,80):null,loadingSetTo:!!src,alt},timestamp:Date.now(),hypothesisId:'H-A-B-C'})}).catch(()=>{});
    // #endregion
  }, [src]);

  const handleImageLoad = () => {
    setImageLoading(false);
    setImageError(false);
    // #region agent log
    fetch('http://127.0.0.1:7869/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'27238b'},body:JSON.stringify({sessionId:'27238b',location:'Avatar.tsx:onLoad',message:'Avatar image loaded (onLoad fired)',data:{src:src?src.substring(0,80):null,alt},timestamp:Date.now(),hypothesisId:'H-A'})}).catch(()=>{});
    // #endregion
  };

  const handleImageError = () => {
    setImageLoading(false);
    setImageError(true);
  };

  const showFallback = !src || imageError;

  return (
    <div
      aria-label={alt}
      className={`
        relative rounded-full overflow-hidden flex items-center justify-center
        ${sizeClasses[size]}
        ${showFallback ? 'bg-blue-100' : 'bg-gray-200'}
        ${className}
      `}
    >
      {!showFallback && (
        <>
          {imageLoading && (
            <div className="absolute inset-0 bg-gray-200 animate-pulse" />
          )}
          <img
            src={src}
            alt=""
            className="w-full h-full object-cover"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        </>
      )}
      
      {showFallback && (
        <>
          {fallbackText ? (
            <span className="font-medium text-blue-600 uppercase">
              {fallbackText.charAt(0)}
            </span>
          ) : (
            <User className={`text-blue-600 ${iconSizes[size]}`} />
          )}
        </>
      )}
    </div>
  );
};
