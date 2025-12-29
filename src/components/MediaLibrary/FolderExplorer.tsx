// =====================================================
// FOLDER EXPLORER - NAVEGADOR DE PASTAS
// =====================================================
// Componente para navegação hierárquica de pastas

import React, { useState } from 'react'
import { MediaFolder } from '../../services/mediaManagement'
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Home,
  Loader2
} from 'lucide-react'

// =====================================================
// INTERFACES
// =====================================================

interface FolderExplorerProps {
  folders: MediaFolder[]
  currentFolder?: MediaFolder
  onFolderSelect: (folder?: MediaFolder) => void
  loading: boolean
}

interface FolderTreeItemProps {
  folder: MediaFolder
  level: number
  isSelected: boolean
  isExpanded: boolean
  onSelect: (folder: MediaFolder) => void
  onToggle: (folderId: string) => void
  children?: MediaFolder[]
}

// =====================================================
// COMPONENTE ITEM DA ÁRVORE
// =====================================================

const FolderTreeItem: React.FC<FolderTreeItemProps> = ({
  folder,
  level,
  isSelected,
  isExpanded,
  onSelect,
  onToggle,
  children = []
}) => {
  const hasChildren = children.length > 0

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? 'bg-blue-100 text-blue-700'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={() => onSelect(folder)}
      >
        {/* Botão de expansão */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle(folder.id)
            }}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        ) : (
          <div className="w-5" />
        )}

        {/* Ícone da pasta */}
        <div className="flex-shrink-0">
          {isSelected ? (
            <FolderOpen className="w-4 h-4" />
          ) : (
            <Folder className="w-4 h-4" />
          )}
        </div>

        {/* Nome da pasta */}
        <span className="flex-1 truncate text-sm font-medium">
          {folder.name}
        </span>

        {/* Contador de arquivos */}
        {folder.file_count > 0 && (
          <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
            {folder.file_count}
          </span>
        )}
      </div>

      {/* Subpastas */}
      {hasChildren && isExpanded && (
        <div>
          {children.map(child => (
            <FolderTreeItemContainer
              key={child.id}
              folder={child}
              level={level + 1}
              allFolders={[]} // Será passado pelo container pai
              currentFolder={undefined} // Será passado pelo container pai
              onSelect={onSelect}
              expandedFolders={[]} // Será passado pelo container pai
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// =====================================================
// CONTAINER PARA ITEM DA ÁRVORE
// =====================================================

interface FolderTreeItemContainerProps {
  folder: MediaFolder
  level: number
  allFolders: MediaFolder[]
  currentFolder?: MediaFolder
  onSelect: (folder: MediaFolder) => void
  expandedFolders: string[]
  onToggle: (folderId: string) => void
}

const FolderTreeItemContainer: React.FC<FolderTreeItemContainerProps> = ({
  folder,
  level,
  allFolders,
  currentFolder,
  onSelect,
  expandedFolders,
  onToggle
}) => {
  const isSelected = currentFolder?.id === folder.id
  const isExpanded = expandedFolders.includes(folder.id)
  const children = allFolders.filter(f => f.parent_id === folder.id)

  return (
    <FolderTreeItem
      folder={folder}
      level={level}
      isSelected={isSelected}
      isExpanded={isExpanded}
      onSelect={onSelect}
      onToggle={onToggle}
      children={children}
    />
  )
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const FolderExplorer: React.FC<FolderExplorerProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
  loading
}) => {
  const [expandedFolders, setExpandedFolders] = useState<string[]>([])

  // Obter pastas raiz (sem parent_id)
  const rootFolders = folders.filter(f => !f.parent_id)

  // Handler para expandir/contrair pastas
  const handleToggle = (folderId: string) => {
    setExpandedFolders(prev =>
      prev.includes(folderId)
        ? prev.filter(id => id !== folderId)
        : [...prev, folderId]
    )
  }

  // Handler para selecionar pasta
  const handleSelect = (folder?: MediaFolder) => {
    onFolderSelect(folder)
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200">
        <Folder className="w-5 h-5 text-gray-600" />
        <h3 className="font-semibold text-gray-900">Pastas</h3>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>

      {/* Pasta raiz */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-2 ${
          !currentFolder
            ? 'bg-blue-100 text-blue-700'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
        onClick={() => handleSelect(undefined)}
      >
        <Home className="w-4 h-4" />
        <span className="text-sm font-medium">Biblioteca</span>
      </div>

      {/* Loading state */}
      {loading && folders.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Carregando pastas...</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && folders.length === 0 && (
        <div className="text-center py-8">
          <Folder className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-2">Nenhuma pasta criada</p>
          <p className="text-xs text-gray-400">
            Clique em "Nova Pasta" para começar
          </p>
        </div>
      )}

      {/* Árvore de pastas */}
      {!loading && rootFolders.length > 0 && (
        <div className="space-y-1">
          {rootFolders.map(folder => (
            <FolderTreeItemContainer
              key={folder.id}
              folder={folder}
              level={0}
              allFolders={folders}
              currentFolder={currentFolder}
              onSelect={handleSelect}
              expandedFolders={expandedFolders}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* Estatísticas */}
      {!loading && folders.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>Total de pastas:</span>
              <span className="font-medium">{folders.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Arquivos totais:</span>
              <span className="font-medium">
                {folders.reduce((sum, f) => sum + (f.file_count || 0), 0)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
