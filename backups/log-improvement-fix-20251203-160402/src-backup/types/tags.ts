// Interfaces TypeScript para o Sistema de Tags
// Data: 2025-11-28

export interface Tag {
  id: string;
  company_id: string;
  name: string;
  color: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  leads_count?: number; // Para validação de exclusão
}

export interface TagFormData {
  name: string;
  color: string;
  description?: string;
}

export interface TagAssignment {
  id: string;
  lead_id: number;
  tag_id: string;
  assigned_at: string;
  tag?: Tag; // Para joins
}

export interface LeadWithTags {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  tags: Tag[];
}

export interface TagsManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTagsChange?: () => void;
}

export interface TagFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  tag?: Tag | null;
  onSave: (tagData: TagFormData) => Promise<void>;
}

export interface LeadTagsFieldProps {
  leadId?: number;
  selectedTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  disabled?: boolean;
}

export interface TagBadgeProps {
  tag: Tag;
  size?: 'sm' | 'md' | 'lg';
  removable?: boolean;
  onRemove?: (tagId: string) => void;
}

export interface ColorPaletteProps {
  colors: string[];
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

export interface CustomColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

// Cores pré-definidas para tags
export const PREDEFINED_COLORS = [
  '#3B82F6', // Azul
  '#10B981', // Verde
  '#F59E0B', // Amarelo/Laranja
  '#EF4444', // Vermelho
  '#8B5CF6', // Roxo
  '#06B6D4', // Ciano
  '#F97316', // Laranja
  '#84CC16', // Verde Lima
  '#EC4899', // Rosa
  '#6B7280', // Cinza
  '#1F2937', // Cinza Escuro
  '#7C3AED'  // Violeta
];

// Utilitários para cores
export const getTextColor = (backgroundColor: string): string => {
  // Remove o # se presente
  const hex = backgroundColor.replace('#', '');
  
  // Converte para RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Calcula a luminância
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Retorna branco ou preto baseado na luminância
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

export const validateHexColor = (color: string): boolean => {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
};

export const hasGoodContrast = (hexColor: string): boolean => {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.3 && luminance < 0.7; // Contraste adequado
};
