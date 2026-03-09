import React, { useState, useEffect } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { CustomActivityType } from '../../types/calendar'
import { AVAILABLE_ICONS } from '../../types/calendar'

interface ActivityTypesModalProps {
  onClose: () => void
  onSave: () => void
}

export const ActivityTypesModal: React.FC<ActivityTypesModalProps> = ({ onClose, onSave }) => {
  const { company } = useAuth()
  const [activityTypes, setActivityTypes] = useState<CustomActivityType[]>([])
  const [loading, setLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [selectedIcon, setSelectedIcon] = useState('')
  const [showIconPicker, setShowIconPicker] = useState(false)

  useEffect(() => {
    if (company?.id) {
      fetch(`/api/activity-types?company_id=${company.id}`)
        .then(res => res.json())
        .then(data => { setActivityTypes(data); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [company?.id])

  const handleSave = async () => {
    if (!newTypeName.trim() || !selectedIcon || !company?.id) return
    const res = await fetch(`/api/activity-types?company_id=${company.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTypeName.trim(), icon: selectedIcon, color: 'blue' })
    })
    if (res.ok) {
      const data = await fetch(`/api/activity-types?company_id=${company.id}`).then(r => r.json())
      setActivityTypes(data)
      setNewTypeName('')
      setSelectedIcon('')
      setIsCreating(false)
      onSave()
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este tipo?')) return
    await fetch(`/api/activity-types?company_id=${company.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    const data = await fetch(`/api/activity-types?company_id=${company.id}`).then(r => r.json())
    setActivityTypes(data)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[85vh] overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Tipos de Atividade</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(85vh-140px)]">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-200 border-t-blue-600"></div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {activityTypes.map(type => (
                  <div key={type.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <div className="w-8 h-8 flex items-center justify-center bg-blue-50 rounded">
                      <span className="text-blue-600 text-lg">{type.icon}</span>
                    </div>
                    <span className="flex-1 text-sm font-medium text-gray-900">{type.name}</span>
                    {!type.is_system ? (
                      <button onClick={() => handleDelete(type.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400 px-2 py-1 bg-gray-100 rounded">Sistema</span>
                    )}
                  </div>
                ))}
              </div>

              {!isCreating && (
                <button onClick={() => setIsCreating(true)} className="mt-4 w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" />
                  Adicionar Tipo
                </button>
              )}

              {isCreating && (
                <div className="mt-4 p-4 border-2 border-blue-200 rounded-lg bg-blue-50/30">
                  <input
                    type="text"
                    placeholder="Nome do tipo"
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    maxLength={100}
                  />
                  <button onClick={() => setShowIconPicker(!showIconPicker)} className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-left flex items-center gap-2">
                    {selectedIcon ? <><span className="text-lg">{selectedIcon}</span><span>Ícone selecionado</span></> : <span className="text-gray-400">Selecionar ícone</span>}
                  </button>
                  {showIconPicker && (
                    <div className="mt-3 p-3 border border-gray-200 rounded-lg bg-white max-h-60 overflow-y-auto">
                      <div className="grid grid-cols-10 gap-2">
                        {AVAILABLE_ICONS.map(icon => (
                          <button key={icon} onClick={() => { setSelectedIcon(icon); setShowIconPicker(false) }} className="w-8 h-8 flex items-center justify-center hover:bg-blue-100 rounded">
                            <span className="text-blue-600 text-lg">{icon}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex gap-2">
                    <button onClick={handleSave} disabled={!newTypeName.trim() || !selectedIcon} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">Salvar</button>
                    <button onClick={() => { setIsCreating(false); setNewTypeName(''); setSelectedIcon('') }} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">Cancelar</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
