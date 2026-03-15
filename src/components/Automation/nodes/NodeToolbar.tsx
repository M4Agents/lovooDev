// =====================================================
// COMPONENT: NODE TOOLBAR
// Data: 15/03/2026
// Objetivo: Barra de ferramentas flutuante para ações nos nós
// Estilo: Datacraz
// =====================================================

import { Trash2, Copy, FolderOpen } from 'lucide-react'

interface NodeToolbarProps {
  onDelete: () => void
  onDuplicate: () => void
  onOpen: () => void
}

export default function NodeToolbar({ onDelete, onDuplicate, onOpen }: NodeToolbarProps) {
  return (
    <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-white rounded shadow-md border border-gray-200 px-1 py-0.5 flex items-center gap-0.5 z-50">
      {/* Excluir */}
      <button
        onClick={onDelete}
        className="p-0.5 hover:bg-red-50 rounded transition-colors group"
        title="Excluir"
      >
        <Trash2 className="w-3 h-3 text-gray-600 group-hover:text-red-600" />
      </button>

      {/* Duplicar */}
      <button
        onClick={onDuplicate}
        className="p-0.5 hover:bg-blue-50 rounded transition-colors group"
        title="Duplicar"
      >
        <Copy className="w-3 h-3 text-gray-600 group-hover:text-blue-600" />
      </button>

      {/* Abrir/Configurar */}
      <button
        onClick={onOpen}
        className="p-0.5 hover:bg-gray-100 rounded transition-colors group"
        title="Configurar"
      >
        <FolderOpen className="w-3 h-3 text-gray-600 group-hover:text-gray-900" />
      </button>
    </div>
  )
}
