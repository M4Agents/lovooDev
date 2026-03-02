// Modal para criação/edição de tags
// Data: 2025-11-28

import React, { useState, useEffect } from 'react';
import { X, Tag as TagIcon } from 'lucide-react';
import { Tag, TagFormData, validateHexColor } from '../types/tags';
import { ColorPicker } from './ColorPicker';
import { TagBadge } from './TagBadge';

interface TagFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  tag?: Tag | null;
  onSave: (tagData: TagFormData) => Promise<void>;
}

export const TagFormModal: React.FC<TagFormModalProps> = ({
  isOpen,
  onClose,
  tag,
  onSave
}) => {
  const [formData, setFormData] = useState<TagFormData>({
    name: '',
    color: '#3B82F6',
    description: ''
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Preencher formulário quando for edição
  useEffect(() => {
    if (isOpen) {
      if (tag) {
        setFormData({
          name: tag.name,
          color: tag.color,
          description: tag.description || ''
        });
      } else {
        setFormData({
          name: '',
          color: '#3B82F6',
          description: ''
        });
      }
      setErrors([]);
    }
  }, [isOpen, tag]);

  const validateForm = (): string[] => {
    const newErrors: string[] = [];

    if (!formData.name.trim()) {
      newErrors.push('Nome da tag é obrigatório');
    }

    if (formData.name.trim().length > 100) {
      newErrors.push('Nome da tag deve ter no máximo 100 caracteres');
    }

    if (!validateHexColor(formData.color)) {
      newErrors.push('Cor deve estar no formato hexadecimal (#RRGGBB)');
    }

    if (formData.description && formData.description.length > 500) {
      newErrors.push('Descrição deve ter no máximo 500 caracteres');
    }

    return newErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);
    setErrors([]);

    try {
      await onSave({
        name: formData.name.trim(),
        color: formData.color,
        description: formData.description?.trim() || undefined
      });
      onClose();
    } catch (error) {
      console.error('Error saving tag:', error);
      setErrors(['Erro ao salvar tag. Tente novamente.']);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof TagFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Limpar erros quando usuário começar a digitar
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  // Criar tag de preview
  const previewTag: Tag = {
    id: 'preview',
    company_id: '',
    name: formData.name || 'Nome da Tag',
    color: formData.color,
    description: formData.description,
    is_active: true,
    created_at: '',
    updated_at: ''
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <TagIcon className="w-5 h-5 mr-2" />
            {tag ? 'Editar Tag' : 'Nova Tag'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Erros */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <ul className="text-sm text-red-600 space-y-1">
                {errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Nome da Tag */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nome da Tag *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ex: Marketing Digital"
              maxLength={100}
              disabled={loading}
              required
            />
          </div>

          {/* Seletor de Cor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cor da Tag *
            </label>
            <ColorPicker
              selectedColor={formData.color}
              onColorChange={(color) => handleInputChange('color', color)}
              disabled={loading}
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Descrição (opcional)
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Descrição da tag..."
              rows={3}
              maxLength={500}
              disabled={loading}
            />
          </div>

          {/* Preview */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Preview
            </label>
            <div className="p-3 bg-gray-50 rounded-lg">
              <TagBadge tag={previewTag} size="md" />
            </div>
          </div>

          {/* Botões */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Salvando...' : (tag ? 'Atualizar' : 'Criar Tag')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
