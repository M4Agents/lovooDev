// =====================================================
// LOCKED CHAT PANEL
// =====================================================
// Estado visual exibido quando o lead está fora do plano
// (is_over_plan = true). Reutilizado em ChatLayout e ChatModal.

import React from 'react'

interface LockedChatPanelProps {
  contactName?: string
}

export const LockedChatPanel: React.FC<LockedChatPanelProps> = ({ contactName }) => (
  <div className="flex items-center justify-center h-full">
    <div className="text-center p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-amber-200/60 max-w-md">
      <div className="mb-6">
        <div className="mx-auto h-20 w-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl flex items-center justify-center shadow-lg">
          <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
      </div>

      <h3 className="text-xl font-semibold text-slate-800 mb-2">
        Conversa bloqueada
      </h3>

      {contactName && (
        <p className="text-slate-500 text-sm mb-4 font-medium">{contactName}</p>
      )}

      <p className="text-slate-600 leading-relaxed text-sm mb-6">
        Este lead está fora do limite do seu plano atual.
        Faça upgrade ou exclua leads antigos para liberar o acesso à conversa.
      </p>

      <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-700 font-medium">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Lead fora do plano — dados restritos
      </div>
    </div>
  </div>
)
