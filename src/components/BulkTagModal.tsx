import React, { useState, useEffect } from 'react';
import { X, Tag } from 'lucide-react';
import type { Tag as LeadTag } from '../types/tags';

interface BulkTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tagIds: string[]) => void;
  selectedCount: number;
  availableTags: LeadTag[];
  loading: boolean;
}

export const BulkTagModal: React.FC<BulkTagModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  selectedCount,
  availableTags,
  loading,
}) => {
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  // Reseta a seleção sempre que o modal é fechado (isOpen: true → false).
  // Garante estado limpo na próxima abertura, independentemente do caminho
  // de fechamento: cancelamento, X ou fechamento pelo pai após sucesso.
  // O efeito SÓ dispara na transição para false — não interfere enquanto
  // isOpen === true (ex.: loading ativo, erro de API com modal aberto).
  useEffect(() => {
    if (!isOpen) {
      setSelectedTagIds(new Set());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const noTags = availableTags.length === 0;

  const toggleTag = (tagId: string) => {
    if (loading) return;
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (loading || selectedTagIds.size === 0) return;
    onConfirm(Array.from(selectedTagIds));
  };

  const handleClose = () => {
    if (loading) return;
    setSelectedTagIds(new Set());
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Atribuir Tags</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">
            Você selecionou{' '}
            <span className="font-semibold text-gray-900">{selectedCount}</span>{' '}
            {selectedCount === 1 ? 'lead' : 'leads'}. Escolha as tags que serão adicionadas a{' '}
            {selectedCount === 1 ? 'ele' : 'todos eles'}.
            {' '}Tags já existentes não serão removidas.
          </p>

          {noTags ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              Nenhuma tag disponível para esta empresa.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                  Tags disponíveis
                </label>
                {selectedTagIds.size > 0 && (
                  <span className="text-xs text-blue-600 font-medium">
                    {selectedTagIds.size} tag{selectedTagIds.size !== 1 ? 's' : ''} selecionada{selectedTagIds.size !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {availableTags.map((tag) => {
                  const isSelected = selectedTagIds.has(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                        loading ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTag(tag.id)}
                        disabled={loading}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tag.color ?? '#3B82F6' }}
                      />
                      <span className="text-sm text-gray-800 truncate">{tag.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || selectedTagIds.size === 0 || noTags}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Atribuindo...
              </>
            ) : (
              <>
                <Tag className="w-4 h-4" />
                Confirmar Atribuição
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
