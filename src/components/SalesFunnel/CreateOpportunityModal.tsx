// =====================================================
// COMPONENTE: CreateOpportunityModal
// Data: 04/03/2026
// Objetivo: Modal para criar nova oportunidade manualmente
// =====================================================

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X, Briefcase, DollarSign, Calendar, Percent, FileText, User } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { funnelApi } from '../../services/funnelApi'
import { catalogApi } from '../../services/catalogApi'
import { getCompanyUsers } from '../../services/userApi'
import { supabase } from '../../lib/supabase'
import type { CreateOpportunityForm } from '../../types/sales-funnel'
import type { CompanyUser } from '../../types/user'
import { SUPPORTED_CURRENCIES } from '../../lib/currencies'
import {
  normalizeOpportunityManualValue,
  parseOpportunityCompositionError,
  resolveOpportunityCompositionErrorMessage
} from '../../utils/opportunityCompositionErrors'

const MANAGEMENT_ROLES = ['super_admin', 'support', 'admin', 'partner', 'manager']

interface CreateOpportunityModalProps {
  isOpen: boolean
  onClose: () => void
  leadId: number
  leadName: string
  opportunityData?: any
  onSuccess?: () => void
}

export const CreateOpportunityModal: React.FC<CreateOpportunityModalProps> = ({
  isOpen,
  onClose,
  leadId,
  leadName,
  opportunityData,
  onSuccess
}) => {
  const { t } = useTranslation('funnel')
  const { company, user, currentRole, userRoles } = useAuth()
  const hasPlatformElevatedRole = userRoles.some(
    r => r.role === 'super_admin' || r.role === 'support'
  )
  const isManager =
    (currentRole ? MANAGEMENT_ROLES.includes(currentRole) : false) ||
    company?.is_super_admin === true ||
    hasPlatformElevatedRole
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [valueDisplay, setValueDisplay] = useState('0,00')
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const isEditMode = !!opportunityData

  const [formData, setFormData] = useState<Partial<CreateOpportunityForm>>({
    title: '',
    description: '',
    value: 0,
    currency: 'BRL',
    probability: 50,
    expected_close_date: '',
    source: '',
    owner_user_id: undefined
  })

  // Preencher formulário quando estiver editando
  useEffect(() => {
    if (isOpen && opportunityData) {
      setFormData({
        title: opportunityData.title || '',
        description: opportunityData.description || '',
        value: opportunityData.value || 0,
        currency: opportunityData.currency || 'BRL',
        probability: opportunityData.probability || 50,
        expected_close_date: opportunityData.expected_close_date || '',
        source: opportunityData.source || ''
      })
      
      // Formatar valor para exibição
      if (opportunityData.value) {
        const formatted = opportunityData.value.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
        setValueDisplay(formatted)
      }
    }
  }, [isOpen, opportunityData])

  // Nova oportunidade: moeda padrão da empresa
  useEffect(() => {
    if (!isOpen || opportunityData || !company) return
    const dc = company.default_currency ?? 'BRL'
    setFormData(prev => ({ ...prev, currency: dc }))
  }, [isOpen, opportunityData, company])

  // Buscar origem e responsável do lead ao abrir modal
  useEffect(() => {
    const fetchLeadData = async () => {
      if (!isOpen || !leadId) return

      try {
        const { data } = await supabase
          .from('leads')
          .select('lead_source, responsible_user_id')
          .eq('id', leadId)
          .single()

        if (data) {
          // Prioridade: responsible_user_id do lead → auth.uid() como fallback
          const defaultOwner = data.responsible_user_id ?? user?.id ?? undefined
          setFormData(prev => ({
            ...prev,
            source: data.lead_source || prev.source,
            owner_user_id: defaultOwner
          }))
        }
      } catch (err) {
        console.error('Erro ao buscar dados do lead:', err)
        // Fallback: usuário atual
        setFormData(prev => ({ ...prev, owner_user_id: user?.id ?? undefined }))
      }
    }

    fetchLeadData()
  }, [isOpen, leadId, user?.id])

  // Buscar usuários da empresa (apenas para admin/manager poderem reatribuir)
  useEffect(() => {
    if (!isOpen || !company?.id || !isManager) return
    getCompanyUsers(company.id).then(setCompanyUsers).catch(() => setCompanyUsers([]))
  }, [isOpen, company?.id, isManager])

  // Resetar formulário quando modal fechar
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        title: '',
        description: '',
        value: 0,
        currency: company?.default_currency ?? 'BRL',
        probability: 50,
        expected_close_date: '',
        source: '',
        owner_user_id: undefined
      })
      setValueDisplay('0,00')
      setError(undefined)
      setCompanyUsers([])
    }
  }, [isOpen, company?.default_currency])

  // Atualizar display do valor com formatação brasileira
  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value
    
    // Remover tudo exceto números
    const numbersOnly = input.replace(/\D/g, '')
    
    if (!numbersOnly) {
      setValueDisplay('0,00')
      setFormData({ ...formData, value: 0 })
      return
    }
    
    // Converter para número (centavos)
    const numericValue = parseInt(numbersOnly) / 100
    
    // Formatar para moeda brasileira
    const formatted = numericValue.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
    
    setValueDisplay(formatted)
    setFormData({ ...formData, value: numericValue })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!company?.id) {
      setError(t('createOpportunity.errors.companyRequired'))
      return
    }

    if (!formData.title?.trim()) {
      setError(t('createOpportunity.errors.titleRequired'))
      return
    }

    try {
      setLoading(true)
      setError(undefined)

      let result
      
      if (isEditMode && opportunityData) {
        // Modo de edição - atualizar oportunidade existente
        console.log('✏️ CreateOpportunityModal - Atualizando oportunidade:', opportunityData.id)
        const ent = await catalogApi.getOpportunityItemsEntitlement(company.id)
        const manualMode = (opportunityData.value_mode ?? 'manual') === 'manual'
        result = await funnelApi.updateOpportunity(
          opportunityData.id,
          {
            title: formData.title,
            description: formData.description,
            value: normalizeOpportunityManualValue(formData.value ?? 0),
            probability: formData.probability || 50,
            expected_close_date: formData.expected_close_date || undefined
          },
          {
            companyId: company.id,
            useCompositionManualValueRpc: ent.allowed && manualMode,
          }
        )
        console.log('✅ CreateOpportunityModal - Oportunidade atualizada com sucesso:', result)
      } else {
        // Modo de criação - criar nova oportunidade
        console.log('🚀 CreateOpportunityModal - Criando oportunidade com dados:', {
          lead_id: leadId,
          lead_id_type: typeof leadId,
          company_id: company.id,
          title: formData.title,
          value: formData.value,
          probability: formData.probability
        })

        const newOpportunityData = {
          lead_id: leadId,
          company_id: company.id,
          title: formData.title,
          description: formData.description,
          value: normalizeOpportunityManualValue(formData.value),
          currency: formData.currency || company.default_currency || 'BRL',
          probability: formData.probability || 50,
          expected_close_date: formData.expected_close_date || undefined,
          source: formData.source,
          owner_user_id: formData.owner_user_id || user?.id || undefined
        }

        console.log('📦 CreateOpportunityModal - Payload completo:', newOpportunityData)
        
        result = await funnelApi.createOpportunity(newOpportunityData)
        console.log('✅ CreateOpportunityModal - Oportunidade criada com sucesso:', result)
      }

      // Adicionar automaticamente ao funil padrão (apenas ao criar)
      if (!isEditMode) {
        console.log('🚀 CreateOpportunityModal - INICIANDO ADIÇÃO AUTOMÁTICA AO FUNIL...')
      }

      try {
        if (!isEditMode) {
        console.log('🎯 CreateOpportunityModal - Buscando funil padrão para adicionar oportunidade...')
        console.log('🏢 CreateOpportunityModal - Company ID:', company.id)
        
        const funnels = await funnelApi.getFunnels(company.id)
        console.log('📊 CreateOpportunityModal - Funis encontrados:', funnels.length)
        
        if (funnels.length > 0) {
          // Buscar funil padrão ou usar o primeiro
          const defaultFunnel = funnels.find(f => f.is_default) || funnels[0]
          console.log('🎯 CreateOpportunityModal - Funil selecionado:', defaultFunnel.name)
          
          // Buscar etapas do funil
          const stages = await funnelApi.getStages(defaultFunnel.id)
          console.log('📍 CreateOpportunityModal - Etapas encontradas:', stages.length)
          
          if (stages.length > 0) {
            const firstStage = stages[0]
            console.log('📍 CreateOpportunityModal - Primeira etapa:', firstStage.name)
            
            // Adicionar oportunidade ao funil
            await funnelApi.addOpportunityToFunnel(
              result.id,
              defaultFunnel.id,
              firstStage.id,
              leadId
            )
            
            console.log('✅ CreateOpportunityModal - Oportunidade adicionada ao funil com sucesso!')
          } else {
            console.warn('⚠️ CreateOpportunityModal - Funil não tem etapas cadastradas')
          }
        } else {
          console.warn('⚠️ CreateOpportunityModal - Nenhum funil cadastrado para a empresa')
        }
        }
      } catch (funnelError) {
        console.error('❌ CreateOpportunityModal - Erro ao adicionar ao funil:', funnelError)
        // Não bloqueia a criação da oportunidade, apenas loga o erro
      }

      // Resetar formulário
      setFormData({
        title: '',
        description: '',
        value: 0,
        currency: company?.default_currency ?? 'BRL',
        probability: 50,
        expected_close_date: '',
        source: ''
      })
      setValueDisplay('0,00')

      if (onSuccess) onSuccess()
      onClose()
    } catch (err) {
      console.error('Erro ao criar oportunidade:', err)
      const parsed = parseOpportunityCompositionError(err)
      if (parsed.code !== 'UNKNOWN' && /^OPP_/.test(parsed.code)) {
        setError(
          resolveOpportunityCompositionErrorMessage(err, t, 'createOpportunity.errors.generic')
        )
      } else {
        setError(err instanceof Error ? err.message : t('createOpportunity.errors.generic'))
      }
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const modalContent = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {isEditMode ? t('createOpportunity.titleEdit') : t('createOpportunity.titleNew')}
              </h2>
              <p className="text-sm text-gray-500">{t('createOpportunity.leadLine', { name: leadName })}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Título */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('createOpportunity.fields.title')}
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder={t('createOpportunity.fields.titlePlaceholder')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <FileText className="w-4 h-4 inline mr-1" />
              {t('createOpportunity.fields.description')}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t('createOpportunity.fields.descriptionPlaceholder')}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Valor, moeda e Probabilidade */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <DollarSign className="w-4 h-4 inline mr-1" />
                {t('createOpportunity.fields.value')}
              </label>
              <input
                type="text"
                value={valueDisplay}
                onChange={handleValueChange}
                placeholder={t('createOpportunity.fields.valuePlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('createOpportunity.fields.currencyIso')}</label>
              {isEditMode ? (
                <p className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700">
                  {opportunityData?.currency ?? formData.currency ?? 'BRL'}{' '}
                  <span className="text-xs text-gray-400">{t('createOpportunity.fields.currencyLocked')}</span>
                </p>
              ) : (
                <select
                  value={formData.currency || 'BRL'}
                  onChange={e => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                >
                  {SUPPORTED_CURRENCIES.map(c => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Percent className="w-4 h-4 inline mr-1" />
                {t('createOpportunity.fields.probability')}
              </label>
              <input
                type="number"
                value={formData.probability}
                onChange={(e) => setFormData({ ...formData, probability: parseInt(e.target.value) || 50 })}
                placeholder="50"
                min="0"
                max="100"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Data Prevista de Fechamento */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              {t('createOpportunity.fields.expectedClose')}
            </label>
            <input
              type="date"
              value={formData.expected_close_date}
              onChange={(e) => setFormData({ ...formData, expected_close_date: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Responsável */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <User className="w-4 h-4 inline mr-1" />
              {t('createOpportunity.fields.owner')}
            </label>
            {isManager ? (
              <select
                value={formData.owner_user_id ?? ''}
                onChange={(e) => setFormData({ ...formData, owner_user_id: e.target.value || undefined })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
              >
                <option value="">{t('createOpportunity.fields.noOwner')}</option>
                {companyUsers.map(u => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name || u.email || u.user_id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                readOnly
                value={
                  companyUsers.find(u => u.user_id === formData.owner_user_id)?.display_name
                  || companyUsers.find(u => u.user_id === formData.owner_user_id)?.email
                  || (formData.owner_user_id ? t('createOpportunity.fields.you') : t('createOpportunity.fields.noOwner'))
                }
                className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 cursor-default"
              />
            )}
          </div>

          {/* Origem */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('createOpportunity.fields.source')}
            </label>
            <input
              type="text"
              value={formData.source}
              onChange={(e) => setFormData({ ...formData, source: e.target.value })}
              placeholder={t('createOpportunity.fields.sourcePlaceholder')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              disabled={loading}
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isEditMode ? t('form.saving') : t('createOpportunity.creating')}
                </>
              ) : (
                <>
                  <Briefcase className="w-4 h-4" />
                  {isEditMode ? t('form.updateChanges') : t('createOpportunity.createSubmit')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
