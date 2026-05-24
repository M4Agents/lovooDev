// =====================================================
// LinkedInstagramLeadCard
// =====================================================
// Card exibido na 3ª coluna quando conversation.lead_id
// já está preenchido.
// Mostra badge "Lead vinculado" e link para /leads?lead_id=
//
// Rota confirmada no projeto: /leads?lead_id=xxx
// (utilizada em EntityListDrawer.tsx e Leads.tsx)
//
// Não altera WhatsApp, backend, banco ou RLS.
// =====================================================

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { InstagramChatConversation } from '../../../types/instagram-chat'

// =====================================================
// TIPOS
// =====================================================

export interface LinkedInstagramLeadCardProps {
  conversation: InstagramChatConversation
  leadId: number
}

// =====================================================
// COMPONENTE
// =====================================================

export const LinkedInstagramLeadCard: React.FC<LinkedInstagramLeadCardProps> = ({
  conversation,
  leadId,
}) => {
  const { t }    = useTranslation('chat')
  const navigate = useNavigate()

  const displayName =
    conversation.participant_name
    ?? (conversation.participant_username ? `@${conversation.participant_username}` : t('instagram.participantUnknown'))

  return (
    <div className="flex flex-col h-full bg-white/80 backdrop-blur-sm overflow-y-auto">
      {/* Header do participante */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200/60">
        {conversation.participant_avatar ? (
          <img
            src={conversation.participant_avatar}
            alt={displayName}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate">{displayName}</p>
          <p className="text-xs text-slate-500">{t('instagram.contactInstagram')}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-5">
        {/* Badge lead vinculado */}
        <div className="flex items-center gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {t('instagram.leadLinked')}
          </span>
        </div>

        {/* Card do lead */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">Lead #{leadId}</p>
              <p className="text-xs text-slate-500">Instagram Direct</p>
            </div>
          </div>

          {/* Botão Ver Lead — rota /leads?lead_id= confirmada no projeto */}
          <button
            onClick={() => navigate(`/leads?lead_id=${leadId}`)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            {t('instagram.viewLead')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default LinkedInstagramLeadCard
