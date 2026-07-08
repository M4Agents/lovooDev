// =====================================================
// ContactCycleSection
//
// Orquestrador da seção de Motor de Ciclos de Contato em SystemSettings.
// Sub-navegação interna: Configuração / Motivos / Perguntas.
//
// Guard de acesso:
//   canViewContactCycles = false → não renderiza nada
//   canViewContactCycles = true  → renderiza (seller em modo leitura)
//   canManageContactCycles       → habilita ações de CRUD nos painéis
// =====================================================

import React, { useState } from 'react'
import { RefreshCw, HelpCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccessControl } from '../../hooks/useAccessControl'
import { ContactCycleConfigPanel } from './ContactCycleConfigPanel'
import { ContactCycleReasonsPanel } from './ContactCycleReasonsPanel'
import { ContactCycleQuestionsPanel } from './ContactCycleQuestionsPanel'
import { ContactCycleHelpModal } from './ContactCycleHelpModal'

type SubTab = 'config' | 'reasons' | 'questions'

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: 'config',    label: 'Configuração' },
  { id: 'reasons',   label: 'Motivos' },
  { id: 'questions', label: 'Perguntas' },
]

export const ContactCycleSection: React.FC = () => {
  const { company } = useAuth()
  const { canViewContactCycles, canManageContactCycles } = useAccessControl()

  const [activeTab,  setActiveTab]  = useState<SubTab>('config')
  const [showHelp,   setShowHelp]   = useState(false)

  // Guard — seller sem membership ativo ou contexto de empresa ausente
  if (!canViewContactCycles || !company?.id) return null

  const companyId = company.id

  return (
    <div className="border-t border-gray-200 pt-6 space-y-5">

      {/* Modal de ajuda */}
      {showHelp && <ContactCycleHelpModal onClose={() => setShowHelp(false)} />}

      {/* Cabeçalho da seção */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 text-indigo-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Motor de Ciclos de Contato
            </h3>
            <p className="text-sm text-gray-500">
              Configure como as tentativas de contato são registradas e controladas por ciclo.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          title="Como funciona o Motor de Ciclos de Contato"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors border border-indigo-200"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          Como funciona
        </button>
      </div>

      {/* Sub-navegação */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Painéis */}
      <div className="min-h-[200px]">
        {activeTab === 'config' && (
          <ContactCycleConfigPanel
            companyId={companyId}
            canManage={canManageContactCycles}
          />
        )}
        {activeTab === 'reasons' && (
          <ContactCycleReasonsPanel
            companyId={companyId}
            canManage={canManageContactCycles}
          />
        )}
        {activeTab === 'questions' && (
          <ContactCycleQuestionsPanel
            companyId={companyId}
            canManage={canManageContactCycles}
          />
        )}
      </div>
    </div>
  )
}
