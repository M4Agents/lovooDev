// =====================================================
// DashboardTabs — navegação entre abas do dashboard.
// Renderiza [ Operação ] [ Ativação Comercial ].
// Isolado: não conhece o conteúdo de nenhuma aba.
// =====================================================

import React from 'react'

export type DashboardTab = 'operation' | 'activation'

interface Tab {
  id:    DashboardTab
  label: string
}

const TABS: Tab[] = [
  { id: 'operation',  label: 'Operação'            },
  { id: 'activation', label: 'Ativação Comercial'  },
]

interface DashboardTabsProps {
  activeTab: DashboardTab
  onChange:  (tab: DashboardTab) => void
}

export function DashboardTabs({ activeTab, onChange }: DashboardTabsProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 self-start">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={[
            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
            activeTab === tab.id
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
