// =====================================================
// CreateInstagramLeadPanel
// =====================================================
// Painel para converter uma conversa Instagram em Lead.
// Renderizado na 3ª coluna do ChatLayout quando:
//   - selectedChannel === 'instagram'
//   - conversation.lead_id é null
//
// Fluxo:
//   1. Mostra header do participante + badge "Sem lead"
//   2. Botão "Criar Lead" expande o formulário
//   3. Valida name + (phone | email) no frontend
//   4. Chama POST /api/instagram/conversations/[id]/create-lead
//   5. Toast de sucesso + atualiza estado via callback
//
// Não altera WhatsApp, backend, banco ou RLS.
// =====================================================

import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import type { InstagramChatConversation, CreateInstagramLeadPayload, CreateInstagramLeadResponse } from '../../../types/instagram-chat'

// =====================================================
// VALIDAÇÃO
// =====================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

interface ValidationErrors {
  name?: string
  phoneOrEmail?: string
  phone?: string
  email?: string
}

function validate(
  name: string,
  phone: string,
  email: string,
  t: (k: string) => string
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (!name.trim()) {
    errors.name = t('instagram.errorNameRequired')
    return errors
  }

  const hasPhone = phone.trim().length > 0
  const hasEmail = email.trim().length > 0

  if (!hasPhone && !hasEmail) {
    errors.phoneOrEmail = t('instagram.errorPhoneOrEmail')
    return errors
  }

  if (hasPhone) {
    const digits = cleanPhone(phone)
    if (digits.length < 10) {
      errors.phone = t('instagram.errorPhoneInvalid')
    }
  }

  if (hasEmail && !EMAIL_REGEX.test(email.trim())) {
    errors.email = t('instagram.errorEmailInvalid')
  }

  return errors
}

// =====================================================
// TIPOS
// =====================================================

export interface CreateInstagramLeadPanelProps {
  conversation: InstagramChatConversation
  onCreateLead: (
    conversationId: string,
    payload: CreateInstagramLeadPayload
  ) => Promise<CreateInstagramLeadResponse | null>
  createLeadLoading: boolean
  createLeadError: string | undefined
  onClearError: () => void
}

// =====================================================
// COMPONENTE
// =====================================================

export const CreateInstagramLeadPanel: React.FC<CreateInstagramLeadPanelProps> = ({
  conversation,
  onCreateLead,
  createLeadLoading,
  createLeadError,
  onClearError,
}) => {
  const { t } = useTranslation('chat')

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [name,  setName]  = useState(
    conversation.participant_name
      ?? (conversation.participant_username ? `@${conversation.participant_username}` : '')
  )
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<ValidationErrors>({})

  const displayName =
    conversation.participant_name
    ?? (conversation.participant_username ? `@${conversation.participant_username}` : t('instagram.participantUnknown'))

  const handleOpen = useCallback(() => {
    onClearError()
    setErrors({})
    setIsFormOpen(true)
  }, [onClearError])

  const handleCancel = useCallback(() => {
    setIsFormOpen(false)
    setErrors({})
    onClearError()
  }, [onClearError])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    onClearError()

    const errs = validate(name, phone, email, t)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})

    const payload: CreateInstagramLeadPayload = {
      name: name.trim(),
      phone: phone.trim() ? cleanPhone(phone) : null,
      email: email.trim() || null,
    }

    const result = await onCreateLead(conversation.id, payload)

    if (!result) {
      // Erro já está em createLeadError — verificar se é plan_limit_exceeded
      return
    }

    const toastKey: Record<string, string> = {
      lead_created:   'instagram.toastLeadCreated',
      lead_linked:    'instagram.toastLeadLinked',
      already_linked: 'instagram.toastAlreadyLinked',
    }
    toast(t(toastKey[result.action] ?? 'instagram.toastLeadCreated'))
    setIsFormOpen(false)
  }, [name, phone, email, conversation.id, onCreateLead, onClearError, t])

  // Mensagem de erro: tratamento especial para plan_limit_exceeded
  const errorMessage = createLeadError?.includes('plan_limit_exceeded')
    ? t('instagram.toastPlanLimitExceeded')
    : createLeadError

  // ── Render ─────────────────────────────────────────

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
        {/* Badge sem lead */}
        <div className="flex items-center gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {t('instagram.noLeadLinked')}
          </span>
        </div>

        {!isFormOpen ? (
          /* Botão Criar Lead */
          <button
            onClick={handleOpen}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-pink-500 to-pink-600 text-white text-sm font-medium rounded-xl hover:from-pink-600 hover:to-pink-700 transition-all shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {t('instagram.createLead')}
          </button>
        ) : (
          /* Formulário */
          <form onSubmit={handleSubmit} noValidate>
            <p className="text-xs text-slate-500 mb-4">{t('instagram.createLeadHint')}</p>

            {/* Nome */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {t('instagram.fieldName')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setErrors(prev => ({ ...prev, name: undefined })) }}
                placeholder={t('instagram.fieldName')}
                className={`w-full px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-pink-400 transition-colors ${
                  errors.name ? 'border-red-400' : 'border-slate-300'
                }`}
                disabled={createLeadLoading}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            {/* Telefone */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {t('instagram.fieldPhone')}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => { setPhone(e.target.value); setErrors(prev => ({ ...prev, phone: undefined, phoneOrEmail: undefined })) }}
                placeholder="(11) 99999-9999"
                className={`w-full px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-pink-400 transition-colors ${
                  errors.phone ? 'border-red-400' : 'border-slate-300'
                }`}
                disabled={createLeadLoading}
              />
              {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
            </div>

            {/* Email */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {t('instagram.fieldEmail')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: undefined, phoneOrEmail: undefined })) }}
                placeholder="email@exemplo.com"
                className={`w-full px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-pink-400 transition-colors ${
                  errors.email ? 'border-red-400' : 'border-slate-300'
                }`}
                disabled={createLeadLoading}
              />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
            </div>

            {/* Erro phone/email em conjunto */}
            {errors.phoneOrEmail && (
              <p className="text-xs text-red-500 -mt-2 mb-3">{errors.phoneOrEmail}</p>
            )}

            {/* Erro do backend */}
            {errorMessage && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-red-700 flex-1">{errorMessage}</p>
                <button type="button" onClick={onClearError} className="text-red-400 hover:text-red-600">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Botões */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={createLeadLoading}
                className="flex-1 py-2 text-sm text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={createLeadLoading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-pink-600 rounded-xl hover:from-pink-600 hover:to-pink-700 disabled:opacity-50 transition-all shadow-sm"
              >
                {createLeadLoading ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Criando...</span>
                  </>
                ) : (
                  t('instagram.createLead')
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default CreateInstagramLeadPanel
