// =====================================================
// FOLDER SELECTOR - SELETOR DE PASTAS
// =====================================================
// Componente reutilizável para seleção de pastas
// Extraído da BibliotecaV2 para uso em automação

import React from 'react'

interface Folder {
  id: string
  company_id: string
  name: string
  path: string
  parent_id?: string | null
  icon: string
  description?: string
  file_count?: number
  created_at: string
}

interface FolderSelectorProps {
  folders: Folder[]
  selectedFolderId?: string
  onFolderSelect: (folderId: string, folderName: string) => void
}

export const FolderSelector: React.FC<FolderSelectorProps> = ({
  folders,
  selectedFolderId,
  onFolderSelect
}) => {
  console.log('📁 FolderSelector RENDERIZANDO:', { 
    totalFolders: folders.length, 
    selectedFolderId,
    hasOnFolderSelect: typeof onFolderSelect === 'function'
  })
  
  if (folders.length === 0) {
    return (
      <div className="text-center py-8 px-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">📁 Nenhuma pasta disponível</p>
      </div>
    )
  }

  console.log('✅ FolderSelector renderizando', folders.length, 'pastas')
  
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {folders.map((folder, index) => {
        console.log(`📝 Renderizando pasta ${index + 1}:`, folder.name)
        
        return (
          <button
            key={folder.id}
            type="button"
            onClick={(e) => {
              console.log('🖱️ FolderSelector onClick DISPARADO:', { 
                folderId: folder.id, 
                folderName: folder.name,
                event: e.type,
                target: e.target
              })
              onFolderSelect(folder.id, folder.name)
            }}
            className={`w-full text-left p-4 border rounded-lg cursor-pointer transition-all hover:border-blue-300 ${
              selectedFolderId === folder.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
            }`}
          >
          <div className="flex items-center justify-between pointer-events-none">
            <div className="flex items-center space-x-3">
              <span className="text-2xl">{folder.icon}</span>
              <div>
                <p className="font-medium text-gray-800">{folder.name}</p>
                {folder.description && (
                  <p className="text-xs text-gray-500">{folder.description}</p>
                )}
              </div>
            </div>
            <div className="text-sm text-gray-500">
              {folder.file_count || 0} arquivos
            </div>
          </div>
          </button>
        )
      })}
    </div>
  )
}
