// Componente TagBadge - Badge individual de tag
// Data: 2025-11-28

import React from 'react';
import { X } from 'lucide-react';
import { Tag, getTextColor } from '../types/tags';

interface TagBadgeProps {
  tag: Tag;
  size?: 'sm' | 'md' | 'lg';
  removable?: boolean;
  onRemove?: (tagId: string) => void;
}

export const TagBadge: React.FC<TagBadgeProps> = ({ 
  tag, 
  size = 'md', 
  removable = false, 
  onRemove 
}) => {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-0.5 text-sm',
    lg: 'px-3 py-1 text-base'
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3 h-3',
    lg: 'w-4 h-4'
  };

  // Determinar cor do texto baseada na luminância da cor de fundo
  const textColor = getTextColor(tag.color);

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(tag.id);
  };

  return (
    <span 
      className={`inline-flex items-center rounded-full font-medium transition-all ${sizeClasses[size]}`}
      style={{ 
        backgroundColor: tag.color,
        color: textColor
      }}
      title={tag.description || tag.name}
    >
      {tag.name}
      {removable && onRemove && (
        <button
          onClick={handleRemove}
          className="ml-1 hover:opacity-70 transition-opacity"
          type="button"
          aria-label={`Remover tag ${tag.name}`}
        >
          <X className={iconSizes[size]} />
        </button>
      )}
    </span>
  );
};
