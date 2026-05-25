// =====================================================
// ConvertLeadModal — modal para converter comentário em lead
// =====================================================
// Mesmo padrão de CreateInstagramLeadPanel (DMs).
// NÃO auto-cria lead. Usuário deve fornecer nome + telefone/email.

import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import type { CreateCommentLeadPayload, CreateCommentLeadResponse } from '../../types/instagram-comments'

interface ConvertLeadModalProps {
  igUsername: string | null
  loading: boolean
  error?: string
  onSubmit: (payload: CreateCommentLeadPayload) => Promise<CreateCommentLeadResponse | null>
  onClose: () => void
}

function cleanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('55') && digits.length >= 12) return digits
  return `55${digits}`
}

export const ConvertLeadModal: React.FC<ConvertLeadModalProps> = ({
  igUsername,
  loading,
  error,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation('chat')
  const [name,   setName]   = useState(igUsername ? `@${igUsername}` : '')
  const [phone,  setPhone]  = useState('')
  const [email,  setEmail]  = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = t('instagram.errorNameRequired')
    if (!phone.trim() && !email.trim()) errs.contact = t('instagram.errorPhoneOrEmail')
    if (phone.trim()) {
      const digits = phone.replace(/\D/g, '')
      if (digits.length < 10) errs.phone = t('instagram.errorPhoneInvalid')
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = t('instagram.errorEmailInvalid')
    }
    return errs
  }, [name, phone, email, t])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})

    const payload: CreateCommentLeadPayload = {
      name:  name.trim(),
      phone: phone.trim() ? cleanPhone(phone) : null,
      email: email.trim() || null,
    }

    const result = await onSubmit(payload)
    if (!result) return

    if (result.action === 'lead_created') {
      toast.success(t('instagram.toastLeadCreated'))
      onClose()
    } else if (result.action === 'lead_linked') {
      toast.success(t('instagram.toastLeadLinked'))
      onClose()
    } else if (result.action === 'already_linked') {
      toast(t('instagram.toastAlreadyLinked'))
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              {t('instagram.comments.actions.convertLead')}
            </h3>
            {igUsername && (
              <p className="text-sm text-slate-500 mt-0.5">@{igUsername}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {(error && error !== 'plan_limit_exceeded') && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {t('instagram.toastCreateLeadError')}
          </div>
        )}
        {error === 'plan_limit_exceeded' && (
          <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700">
            {t('instagram.toastPlanLimitExceeded')}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">{t('instagram.fieldName')} *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300 disabled:opacity-60"
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">{t('instagram.fieldPhone')}</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="11 99999-9999"
              disabled={loading}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300 disabled:opacity-60"
            />
            {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">{t('instagram.fieldEmail')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              disabled={loading}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-300 disabled:opacity-60"
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>

          {errors.contact && (
            <p className="text-xs text-red-500">{errors.contact}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 text-sm text-slate-600 border border-slate-200 rounded-xl py-2.5 hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              {t('instagram.comments.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-medium bg-purple-600 text-white rounded-xl py-2.5 hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {loading && <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {t('instagram.comments.actions.convertLead')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ConvertLeadModal
