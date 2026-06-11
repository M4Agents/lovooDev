import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { Clock, Save, Coins, Globe2, Bell, ShoppingBag, Users } from 'lucide-react'
import { useAccessControl } from '../../hooks/useAccessControl'
import { TimezoneSelector } from './TimezoneSelector'
import { SUPPORTED_CURRENCIES } from '../../lib/currencies'
import { LeadReentryConfigSection } from './LeadReentryConfigSection'
import { catalogApi } from '../../services/catalogApi'

const COMMON_TIMEZONE_DEFS = [
  { value: 'America/Sao_Paulo', labelKey: 'timezones.labels.saoPaulo', regionKey: 'timezones.regions.brazil' },
  { value: 'America/Manaus', labelKey: 'timezones.labels.manaus', regionKey: 'timezones.regions.brazil' },
  { value: 'America/Fortaleza', labelKey: 'timezones.labels.fortaleza', regionKey: 'timezones.regions.brazil' },
  { value: 'America/Argentina/Buenos_Aires', labelKey: 'timezones.labels.buenosAires', regionKey: 'timezones.regions.latam' },
  { value: 'America/Santiago', labelKey: 'timezones.labels.santiago', regionKey: 'timezones.regions.latam' },
  { value: 'America/Lima', labelKey: 'timezones.labels.lima', regionKey: 'timezones.regions.latam' },
  { value: 'America/Bogota', labelKey: 'timezones.labels.bogota', regionKey: 'timezones.regions.latam' },
  { value: 'America/Mexico_City', labelKey: 'timezones.labels.mexicoCity', regionKey: 'timezones.regions.latam' },
  { value: 'America/New_York', labelKey: 'timezones.labels.newYork', regionKey: 'timezones.regions.northAmerica' },
  { value: 'America/Chicago', labelKey: 'timezones.labels.chicago', regionKey: 'timezones.regions.northAmerica' },
  { value: 'America/Los_Angeles', labelKey: 'timezones.labels.losAngeles', regionKey: 'timezones.regions.northAmerica' },
  { value: 'America/Toronto', labelKey: 'timezones.labels.toronto', regionKey: 'timezones.regions.northAmerica' },
  { value: 'Europe/Lisbon', labelKey: 'timezones.labels.lisbon', regionKey: 'timezones.regions.europe' },
  { value: 'Europe/Madrid', labelKey: 'timezones.labels.madrid', regionKey: 'timezones.regions.europe' },
  { value: 'Europe/Paris', labelKey: 'timezones.labels.paris', regionKey: 'timezones.regions.europe' },
  { value: 'Europe/London', labelKey: 'timezones.labels.london', regionKey: 'timezones.regions.europe' },
  { value: 'Europe/Berlin', labelKey: 'timezones.labels.berlin', regionKey: 'timezones.regions.europe' },
  { value: 'Europe/Rome', labelKey: 'timezones.labels.rome', regionKey: 'timezones.regions.europe' },
  { value: 'Asia/Tokyo', labelKey: 'timezones.labels.tokyo', regionKey: 'timezones.regions.asia' },
  { value: 'Asia/Shanghai', labelKey: 'timezones.labels.shanghai', regionKey: 'timezones.regions.asia' },
  { value: 'Asia/Dubai', labelKey: 'timezones.labels.dubai', regionKey: 'timezones.regions.asia' },
  { value: 'Asia/Singapore', labelKey: 'timezones.labels.singapore', regionKey: 'timezones.regions.asia' },
  { value: 'Australia/Sydney', labelKey: 'timezones.labels.sydney', regionKey: 'timezones.regions.oceania' },
  { value: 'Pacific/Auckland', labelKey: 'timezones.labels.auckland', regionKey: 'timezones.regions.oceania' },
] as const

export const SystemSettings: React.FC = () => {
  const { t } = useTranslation('settings.system')
  const { company, refreshCompany } = useAuth()
  const { isMaster } = useAccessControl()

  const [timezone, setTimezone] = useState(company?.timezone || 'America/Sao_Paulo')
  const [defaultCurrency, setDefaultCurrency] = useState(company?.default_currency ?? 'BRL')
  const [countryCode, setCountryCode] = useState((company?.country_code ?? '').trim())
  const [saving, setSaving] = useState(false)
  const [showAllTimezones, setShowAllTimezones] = useState(false)

  const [alertDismissalScope, setAlertDismissalScope] = useState<'company' | 'user'>(
    company?.alert_dismissal_scope ?? 'company'
  )

  // Produtos e Serviços nas Oportunidades
  const [useCatalogItems, setUseCatalogItems] = useState(
    company?.opportunity_items_enabled ?? false
  )
  const [catalogItemsPlanOk, setCatalogItemsPlanOk] = useState(false)

  // Restrição de leads por responsável
  const [restrictLeadsToOwner, setRestrictLeadsToOwner] = useState(
    company?.restrict_leads_to_owner ?? false
  )

  // Restrição de visibilidade do chat por responsável
  const [restrictChatByAssigned, setRestrictChatByAssigned] = useState(
    company?.chat_visibility_by_assigned_to ?? false
  )

  const commonTimezones = useMemo(
    () =>
      COMMON_TIMEZONE_DEFS.map((def) => ({
        value: def.value,
        label: t(def.labelKey),
        region: t(def.regionKey),
      })),
    [t]
  )

  useEffect(() => {
    if (!company) return
    setTimezone(company.timezone || 'America/Sao_Paulo')
    setDefaultCurrency(company.default_currency ?? 'BRL')
    setCountryCode((company.country_code ?? '').trim())
    setAlertDismissalScope(company.alert_dismissal_scope ?? 'company')
    setUseCatalogItems(company.opportunity_items_enabled ?? false)
    setRestrictLeadsToOwner(company.restrict_leads_to_owner ?? false)
    setRestrictChatByAssigned(company.chat_visibility_by_assigned_to ?? false)
  }, [company])

  // Verifica suporte do plano para composição por itens (uma vez por empresa)
  useEffect(() => {
    if (!company?.id) return
    catalogApi.getOpportunityItemsEntitlement(company.id)
      .then(e => setCatalogItemsPlanOk(Boolean(e.plan_ok)))
      .catch(() => setCatalogItemsPlanOk(false))
  }, [company?.id])

  const normalizedCountry = countryCode.trim().toUpperCase() || null
  const countryInvalid =
    normalizedCountry !== null && !/^[A-Z]{2}$/.test(normalizedCountry)
  const companyCountryNorm = (company?.country_code ?? '').trim().toUpperCase() || null

  const handleSave = async () => {
    if (!company?.id) {
      alert(t('alerts.companyNotFound'))
      return
    }
    if (countryInvalid) {
      alert(t('alerts.countryInvalid'))
      return
    }

    try {
      setSaving(true)

      const scopeChanged =
        isMaster &&
        alertDismissalScope !== (company?.alert_dismissal_scope ?? 'company')

      // 1. Salva timezone, moeda, país e flag de catálogo via Supabase client
      const { error } = await supabase
        .from('companies')
        .update({
          timezone,
          default_currency: defaultCurrency,
          country_code: normalizedCountry,
          opportunity_items_enabled: useCatalogItems,
          restrict_leads_to_owner: restrictLeadsToOwner,
          chat_visibility_by_assigned_to: restrictChatByAssigned,
          updated_at: new Date().toISOString(),
        })
        .eq('id', company.id)

      if (error) throw error

      // 2. Salva alert_dismissal_scope via API (com validação RBAC no backend)
      if (scopeChanged) {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token
        if (!token) throw new Error(t('alerts.companyNotFound'))

        const res = await fetch('/api/companies/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            companyId: company.id,
            updates: { alert_dismissal_scope: alertDismissalScope },
          }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(
            res.status === 403
              ? 'Permissão insuficiente para alterar o escopo de dispensa.'
              : (body.error ?? t('alerts.saveError'))
          )
        }
      }

      await refreshCompany()
      alert(t('alerts.saveSuccess'))
    } catch (error) {
      console.error('Erro ao salvar configurações do sistema:', error)
      setAlertDismissalScope(company?.alert_dismissal_scope ?? 'company')
      alert(error instanceof Error ? error.message : t('alerts.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    timezone !== (company?.timezone || 'America/Sao_Paulo') ||
    defaultCurrency !== (company?.default_currency ?? 'BRL') ||
    (normalizedCountry ?? '') !== (companyCountryNorm ?? '') ||
    useCatalogItems !== (company?.opportunity_items_enabled ?? false) ||
    restrictLeadsToOwner !== (company?.restrict_leads_to_owner ?? false) ||
    restrictChatByAssigned !== (company?.chat_visibility_by_assigned_to ?? false) ||
    (isMaster && alertDismissalScope !== (company?.alert_dismissal_scope ?? 'company'))

  const groupedCommonTimezones = commonTimezones.reduce((groups, tz) => {
    if (!groups[tz.region]) {
      groups[tz.region] = []
    }
    groups[tz.region].push(tz)
    return groups
  }, {} as Record<string, typeof commonTimezones>)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Clock className="w-6 h-6 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">{t('timezone.sectionTitle')}</h3>
        </div>
        <p className="text-sm text-gray-600">
          {t('timezone.sectionDescription')}
        </p>
      </div>

      {/* Seletor de Timezone */}
      {!showAllTimezones ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('timezone.commonLabel')}
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            {Object.entries(groupedCommonTimezones).map(([region, timezones]) => (
              <optgroup key={region} label={region}>
                {timezones.map(tz => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <button
            onClick={() => setShowAllTimezones(true)}
            className="mt-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            {t('timezone.seeAll')}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              {t('timezone.allLabel')}
            </label>
            <button
              onClick={() => setShowAllTimezones(false)}
              className="text-sm text-gray-600 hover:text-gray-700 font-medium"
            >
              {t('timezone.backToSuggestions')}
            </button>
          </div>

          <TimezoneSelector value={timezone} onChange={setTimezone} />
        </div>
      )}

      {/* Preview do Horário Atual */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-4">
        <p className="text-sm font-medium text-gray-700 mb-2">
          {t('timezone.currentTimeLabel')}
        </p>
        <p className="text-2xl font-bold text-indigo-900">
          {new Date().toLocaleString('pt-BR', { 
            timeZone: timezone,
            dateStyle: 'full',
            timeStyle: 'long'
          })}
        </p>
        <p className="text-xs text-gray-600 mt-2">
          {t('timezone.timezoneCodePrefix')}{' '}
          <code className="bg-white px-2 py-0.5 rounded">{timezone}</code>
        </p>
      </div>

      {/* Informação Importante */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>{t('timezone.infoBold')}</strong>{' '}
          {t('timezone.infoRest')}
        </p>
      </div>

      {/* Moeda padrão e país (contexto) */}
      <div className="border-t border-gray-200 pt-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Coins className="w-6 h-6 text-indigo-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{t('currency.sectionTitle')}</h3>
            <p className="text-sm text-gray-600">
              <Trans
                i18nKey="currency.sectionDescription"
                ns="settings.system"
                components={{ strong: <strong /> }}
              />
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('currency.defaultLabel')}
            </label>
            <select
              value={defaultCurrency}
              onChange={e => setDefaultCurrency(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            >
              {SUPPORTED_CURRENCIES.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Globe2 className="w-4 h-4 text-gray-500" />
              {t('currency.countryLabel')}
            </label>
            <input
              type="text"
              maxLength={2}
              value={countryCode}
              onChange={e => setCountryCode(e.target.value.toUpperCase())}
              placeholder={t('currency.countryPlaceholder')}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent uppercase ${
                countryInvalid ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {countryInvalid && (
              <p className="text-xs text-red-600 mt-1">{t('currency.countryHintInvalid')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Seção: Produtos e Serviços nas Oportunidades */}
      <div className="border-t border-gray-200 pt-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <ShoppingBag className="w-6 h-6 text-indigo-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Produtos e Serviços nas Oportunidades</h3>
            <p className="text-sm text-gray-600">
              Quando ativo, permite compor o valor da oportunidade a partir do catálogo de produtos e serviços.
              Quando inativo, o valor é informado manualmente.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between py-3 border border-gray-200 rounded-lg px-4">
          <div>
            <p className="text-sm font-medium text-gray-800">
              Usar catálogo de produtos e serviços nas oportunidades
            </p>
            {catalogItemsPlanOk ? (
              <p className="text-xs text-gray-500 mt-0.5">
                Disponível conforme o plano contratado.
              </p>
            ) : (
              <p className="text-xs text-amber-600 mt-0.5">
                Seu plano atual não possui este recurso.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!catalogItemsPlanOk}
            onClick={() => setUseCatalogItems(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              useCatalogItems && catalogItemsPlanOk ? 'bg-indigo-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                useCatalogItems && catalogItemsPlanOk ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Seção: Leads Duplicados e Reentrada */}
      <LeadReentryConfigSection />

      {/* Seção: Escopo de Dispensa de Alertas */}
      <div className="border-t border-gray-200 pt-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Bell className="w-6 h-6 text-indigo-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Escopo de Dispensa de Alertas</h3>
            <p className="text-sm text-gray-600">
              Define se um alerta dispensado por um membro é ocultado para toda a equipe ou apenas para quem o dispensou.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Comportamento das dispensas
          </label>
          <select
            value={alertDismissalScope}
            onChange={e => setAlertDismissalScope(e.target.value as 'company' | 'user')}
            disabled={!isMaster}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="company">
              Empresa — todos os membros veem os mesmos alertas dispensados
            </option>
            <option value="user">
              Individual — cada usuário gerencia suas próprias dispensas
            </option>
          </select>
          {!isMaster && (
            <p className="text-xs text-gray-500 mt-1">
              Apenas administradores podem alterar esta configuração.
            </p>
          )}
        </div>

      </div>

      {/* Restrição de leads por responsável */}
      <div className="border-t pt-6">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-6 h-6 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">Acesso a Leads</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Controle de visibilidade de leads por usuário responsável.
        </p>
        <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Restringir leads por responsável</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Quando ativado, usuários sem permissão <span className="font-mono bg-gray-100 px-1 rounded">view_all_leads</span> visualizam apenas os leads atribuídos a eles.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRestrictLeadsToOwner(v => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
              restrictLeadsToOwner ? 'bg-indigo-600' : 'bg-gray-200'
            }`}
            role="switch"
            aria-checked={restrictLeadsToOwner}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                restrictLeadsToOwner ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {/* Restrição de visibilidade do chat por responsável */}
      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border mt-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">Restringir visibilidade do chat por responsável</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Quando ativado, usuários com perfil <span className="font-mono bg-gray-100 px-1 rounded">Seller</span> visualizam apenas conversas atribuídas a eles ou sem responsável definido.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRestrictChatByAssigned(v => !v)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
            restrictChatByAssigned ? 'bg-indigo-600' : 'bg-gray-200'
          }`}
          role="switch"
          aria-checked={restrictChatByAssigned}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
              restrictChatByAssigned ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges || countryInvalid}
          className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? t('actions.saving') : t('actions.save')}
        </button>

        {hasChanges && (
          <button
            onClick={() => {
              setTimezone(company?.timezone || 'America/Sao_Paulo')
              setDefaultCurrency(company?.default_currency ?? 'BRL')
              setCountryCode((company?.country_code ?? '').trim())
              setAlertDismissalScope(company?.alert_dismissal_scope ?? 'company')
              setUseCatalogItems(company?.opportunity_items_enabled ?? false)
              setRestrictLeadsToOwner(company?.restrict_leads_to_owner ?? false)
              setRestrictChatByAssigned(company?.chat_visibility_by_assigned_to ?? false)
            }}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t('actions.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
