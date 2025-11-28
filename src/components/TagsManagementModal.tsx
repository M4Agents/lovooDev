// Modal principal de gestão de tags
// Data: 2025-11-28

import React, { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, Tag as TagIcon, AlertTriangle } from 'lucide-react';
import { Tag, TagFormData } from '../types/tags';
import { tagsApi } from '../services/tagsApi';
import { TagBadge } from './TagBadge';
import { TagFormModal } from './TagFormModal';
import { useAuth } from '../contexts/AuthContext';

interface TagsManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTagsChange?: () => void;
}

export const TagsManagementModal: React.FC<TagsManagementModalProps> = ({
  isOpen,
  onClose,
  onTagsChange
}) => {
  const { company } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null);
  const [canDeleteCurrentTag, setCanDeleteCurrentTag] = useState<boolean>(true);
  const [checkingDelete, setCheckingDelete] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Carregar tags quando modal abrir
  useEffect(() => {
    if (isOpen && company?.id) {
      loadTags();
    }
  }, [isOpen, company?.id]);

  const loadTags = async () => {
    if (!company?.id) return;

    setLoading(true);
    setError('');

    try {
      const tagsData = await tagsApi.getTags(company.id);
      setTags(tagsData);
    } catch (error) {
      console.error('Error loading tags:', error);
      setError('Erro ao carregar tags. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTag = () => {
    setEditingTag(null);
    setShowTagForm(true);
  };

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag);
    setShowTagForm(true);
  };

  const handleSaveTag = async (tagData: TagFormData) => {
    if (!company?.id) return;

    try {
      if (editingTag) {
        // Atualizar tag existente
        await tagsApi.updateTag(editingTag.id, tagData);
      } else {
        // Criar nova tag
        await tagsApi.createTag(company.id, tagData);
      }

      await loadTags();
      onTagsChange?.();
      setShowTagForm(false);
      setEditingTag(null);
    } catch (error) {
      console.error('Error saving tag:', error);
      throw new Error('Erro ao salvar tag. Verifique se o nome não está duplicado.');
    }
  };

  const handleDeleteTag = async (tag: Tag) => {
    console.log('🔍 [DEBUG] handleDeleteTag called with tag:', tag);
    console.log('🔍 [DEBUG] Tag ID:', tag.id, 'Tag Name:', tag.name);
    
    try {
      // Sempre abrir modal de confirmação primeiro
      console.log('🔍 [DEBUG] Setting deletingTag state...');
      setDeletingTag(tag);
      
      console.log('🔍 [DEBUG] Setting checkingDelete to true...');
      setCheckingDelete(true);
      
      console.log('🔍 [DEBUG] Setting canDeleteCurrentTag to false initially (loading state)...');
      setCanDeleteCurrentTag(false); // Começar com false para mostrar loading
      
      console.log('🔍 [DEBUG] Clearing error state...');
      setError('');

      console.log('🔍 [DEBUG] Adding small delay to ensure modal renders...');
      // Pequeno delay para garantir que o modal seja renderizado antes da verificação
      await new Promise(resolve => setTimeout(resolve, 150));

      console.log('🔍 [DEBUG] Modal should be visible now. Calling API...');
      
      // Verificar se pode excluir em background
      console.log('🔍 [DEBUG] Calling tagsApi.canDeleteTag with ID:', tag.id);
      const canDelete = await tagsApi.canDeleteTag(tag.id);
      console.log('🔍 [DEBUG] API response - canDelete:', canDelete);
      
      console.log('🔍 [DEBUG] Setting canDeleteCurrentTag to:', canDelete);
      setCanDeleteCurrentTag(canDelete);
      
      console.log('🔍 [DEBUG] handleDeleteTag completed successfully');
    } catch (error) {
      console.error('❌ [DEBUG] Error in handleDeleteTag:', error);
      console.error('❌ [DEBUG] Error details:', {
        message: (error as any)?.message,
        stack: (error as any)?.stack
      });
      setCanDeleteCurrentTag(false);
    } finally {
      console.log('🔍 [DEBUG] Setting checkingDelete to false...');
      setCheckingDelete(false);
    }
  };

  const confirmDeleteTag = async () => {
    console.log('✅ [DEBUG] confirmDeleteTag called');
    console.log('✅ [DEBUG] deletingTag:', deletingTag);
    console.log('✅ [DEBUG] canDeleteCurrentTag:', canDeleteCurrentTag);
    
    if (!deletingTag) {
      console.log('❌ [DEBUG] No deletingTag, returning');
      return;
    }

    // Se não pode excluir, não tentar
    if (!canDeleteCurrentTag) {
      console.log('❌ [DEBUG] Cannot delete tag, closing modal');
      setDeletingTag(null);
      return;
    }

    try {
      console.log('🗑️ [DEBUG] Calling tagsApi.deleteTag...');
      await tagsApi.deleteTag(deletingTag.id);
      console.log('🗑️ [DEBUG] Tag deleted successfully, reloading tags...');
      
      await loadTags();
      console.log('🔄 [DEBUG] Tags reloaded, calling onTagsChange...');
      
      onTagsChange?.();
      console.log('🔄 [DEBUG] Closing modal...');
      
      setDeletingTag(null);
      setError('');
      console.log('✅ [DEBUG] confirmDeleteTag completed successfully');
    } catch (error) {
      console.error('❌ [DEBUG] Error deleting tag:', error);
      setError('Erro ao excluir tag. Tente novamente.');
      setDeletingTag(null);
    }
  };

  const handleCloseModal = () => {
    setShowTagForm(false);
    setEditingTag(null);
    setDeletingTag(null);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <TagIcon className="w-5 h-5 mr-2" />
              Gerenciar Tags
            </h3>
            <button
              onClick={handleCloseModal}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Error Message */}
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Create Button */}
            <div className="mb-6">
              <button
                onClick={handleCreateTag}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                disabled={loading}
              >
                <Plus className="w-4 h-4 mr-2" />
                Nova Tag
              </button>
            </div>

            {/* Tags List */}
            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-sm text-gray-600">Carregando tags...</p>
              </div>
            ) : tags.length === 0 ? (
              <div className="text-center py-8">
                <TagIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">Nenhuma tag criada ainda</p>
                <p className="text-sm text-gray-500">Crie sua primeira tag para organizar seus leads</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center space-x-3 flex-1">
                      <TagBadge tag={tag} size="md" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{tag.name}</p>
                        {tag.description && (
                          <p className="text-xs text-gray-500 mt-1">{tag.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {tag.leads_count || 0} lead(s) vinculado(s)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEditTag(tag)}
                        className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                        title="Editar tag"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          console.log('🖱️ [DEBUG] Delete button clicked!');
                          console.log('🖱️ [DEBUG] Event:', e);
                          console.log('🖱️ [DEBUG] Tag to delete:', tag);
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteTag(tag);
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                        title="Excluir tag"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tag Form Modal */}
      <TagFormModal
        isOpen={showTagForm}
        onClose={() => {
          setShowTagForm(false);
          setEditingTag(null);
        }}
        tag={editingTag}
        onSave={handleSaveTag}
      />

      {/* Delete Confirmation Modal */}
      {deletingTag && (() => {
        console.log('🎭 [DEBUG] Rendering delete modal for tag:', deletingTag.name);
        console.log('🎭 [DEBUG] checkingDelete:', checkingDelete);
        console.log('🎭 [DEBUG] canDeleteCurrentTag:', canDeleteCurrentTag);
        console.log('🎭 [DEBUG] Modal should be VISIBLE with z-index 9999');
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{ zIndex: 9999 }}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
              <div className="p-6">
              {checkingDelete ? (
                /* Loading state */
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Verificando...</h3>
                  <p className="text-gray-600">Verificando se a tag pode ser excluída...</p>
                </div>
              ) : canDeleteCurrentTag ? (
                /* Pode excluir - Modal de confirmação normal */
                <>
                  <div className="flex items-center mb-4">
                    <AlertTriangle className="w-6 h-6 text-yellow-600 mr-3" />
                    <h3 className="text-lg font-semibold text-gray-900">Confirmar Exclusão</h3>
                  </div>
                  <p className="text-gray-600 mb-6">
                    Tem certeza que deseja excluir a tag <strong>"{deletingTag.name}"</strong>?
                    Esta ação não pode ser desfeita.
                  </p>
                  <div className="flex justify-end space-x-3">
                    <button
                      onClick={() => setDeletingTag(null)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={confirmDeleteTag}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-lg hover:bg-red-700"
                    >
                      Excluir Tag
                    </button>
                  </div>
                </>
              ) : (
                /* Não pode excluir - Modal de erro */
                <>
                  <div className="flex items-center mb-4">
                    <AlertTriangle className="w-6 h-6 text-red-600 mr-3" />
                    <h3 className="text-lg font-semibold text-gray-900">Não é Possível Excluir</h3>
                  </div>
                  <div className="mb-6">
                    <p className="text-gray-600 mb-3">
                      A tag <strong>"{deletingTag.name}"</strong> não pode ser excluída pois está vinculada a leads.
                    </p>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm text-red-700">
                        <strong>💡 Para excluir esta tag:</strong>
                      </p>
                      <ul className="text-sm text-red-600 mt-2 ml-4 list-disc">
                        <li>Remova a tag de todos os leads que a utilizam</li>
                        <li>Ou edite os leads para usar outras tags</li>
                        <li>Depois tente excluir novamente</li>
                      </ul>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setDeletingTag(null)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Entendi
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
};
