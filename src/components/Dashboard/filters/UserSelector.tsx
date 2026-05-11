// =====================================================
// UserSelector — seletor de vendedor para filtro da dashboard.
//
// RBAC (display):
//   seller   → oculto (backend já filtra; exibir seria confuso)
//   manager+ → dropdown com "Todos" + lista de usuários da empresa
//
// A validação real é feita no backend (/api/dashboard/trends).
// O frontend apenas controla o que exibir; nunca assume permissão.
// =====================================================

import React from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import type { DashboardUser } from '../../../types/dashboard'

interface UserSelectorProps {
  users:     DashboardUser[]
  userId:    string | null
  onSelect:  (id: string | null) => void
  loading?:  boolean
  disabled?: boolean
}

// Roles que podem ver o seletor
const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

export function UserSelector({
  users,
  userId,
  onSelect,
  loading  = false,
  disabled = false,
}: UserSelectorProps) {
  const { currentRole } = useAuth()

  // Seller não vê o seletor — backend já força seu próprio ID
  if (!currentRole || !MANAGER_ROLES.has(currentRole)) return null

  // Se há apenas 1 usuário retornado e não é "todos": sem dropdown útil
  if (!loading && users.length <= 1) return null

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-gray-500 font-medium whitespace-nowrap">
        Vendedor:
      </label>
      <select
        value={userId ?? ''}
        onChange={(e) => onSelect(e.target.value === '' ? null : e.target.value)}
        disabled={disabled || loading}
        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white
                   text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500
                   focus:border-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed
                   max-w-[180px] truncate"
      >
        <option value="">Todos os vendedores</option>
        {users.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.display_name}
          </option>
        ))}
      </select>
    </div>
  )
}
