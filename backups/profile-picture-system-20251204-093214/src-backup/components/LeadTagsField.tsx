// Campo de tags para o formulário de leads
// Data: 2025-11-28

import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tag } from '../types/tags';
import { tagsApi } from '../services/tagsApi';
import { TagBadge } from './TagBadge';
import { useAuth } from '../contexts/AuthContext';

interface LeadTagsFieldProps {
  selectedTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  disabled?: boolean;
}

export const LeadTagsField: React.FC<LeadTagsFieldProps> = ({
  selectedTags,
  onTagsChange,
  disabled = false
}) => {
  const { company } = useAuth();
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carregar tags disponíveis
  useEffect(() => {
    if (company?.id) {
      loadAvailableTags();
    }
  }, [company?.id]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadAvailableTags = async () => {
    if (!company?.id) return;

    setLoading(true);
    try {
      const tags = await tagsApi.getTags(company.id);
      setAvailableTags(tags);
    } catch (error) {
      console.error('Error loading tags:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filtrar tags disponíveis (excluir as já selecionadas)
  const getFilteredTags = () => {
    const selectedTagIds = selectedTags.map(tag => tag.id);
    return availableTags
      .filter(tag => !selectedTagIds.includes(tag.id))
      .filter(tag => 
        searchTerm === '' || 
        tag.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
  };

  const handleTagSelect = (tag: Tag) => {
    const newTags = [...selectedTags, tag];
    onTagsChange(newTags);
    setSearchTerm('');
    inputRef.current?.focus();
  };

  const handleTagRemove = (tagId: string) => {
    const newTags = selectedTags.filter(tag => tag.id !== tagId);
    onTagsChange(newTags);
  };

  const handleInputClick = () => {
    if (!disabled) {
      setIsOpen(true);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchTerm('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const filteredTags = getFilteredTags();
      if (filteredTags.length === 1) {
        handleTagSelect(filteredTags[0]);
      }
    }
  };

  const filteredTags = getFilteredTags();

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Tags
      </label>
      
      {/* Tags selecionadas */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-gray-50 rounded-lg">
          {selectedTags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              size="sm"
              removable={!disabled}
              onRemove={handleTagRemove}
            />
          ))}
        </div>
      )}

      {/* Campo de seleção */}
      <div className="relative" ref={dropdownRef}>
        <div
          onClick={handleInputClick}
          className={`w-full px-3 py-2 border border-gray-300 rounded-lg cursor-pointer transition-colors ${
            disabled 
              ? 'bg-gray-100 cursor-not-allowed' 
              : 'bg-white hover:border-gray-400 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent'
          }`}
        >
          <div className="flex items-center justify-between">
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedTags.length > 0 ? "Adicionar mais tags..." : "Selecionar tags..."}
              className="flex-1 outline-none bg-transparent text-sm"
              disabled={disabled}
            />
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Dropdown */}
        {isOpen && !disabled && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {loading ? (
              <div className="p-3 text-center text-sm text-gray-500">
                Carregando tags...
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="p-3 text-center text-sm text-gray-500">
                {searchTerm ? 'Nenhuma tag encontrada' : 'Todas as tags já foram selecionadas'}
              </div>
            ) : (
              <div className="py-1">
                {filteredTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleTagSelect(tag)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors flex items-center space-x-2"
                  >
                    <TagBadge tag={tag} size="sm" />
                    {tag.description && (
                      <span className="text-xs text-gray-500 truncate">
                        {tag.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Texto de ajuda */}
      <p className="text-xs text-gray-500">
        Selecione uma ou mais tags para categorizar este lead
      </p>
    </div>
  );
};
