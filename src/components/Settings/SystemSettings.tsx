import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { Clock, Save, Coins, Globe2 } from 'lucide-react'
import { TimezoneSelector } from './TimezoneSelector'
import { SUPPORTED_CURRENCIES } from '../../lib/currencies'

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
  const [timezone, setTimezone] = useState(company?.timezone || 'America/Sao_Paulo')
  const [defaultCurrency, setDefaultCurrency] = useState(company?.default_currency ?? 'BRL')
  const [countryCode, setCountryCode] = useState((company?.country_code ?? '').trim())
  const [saving, setSaving] = useState(false)
  const [showAllTimezones, setShowAllTimezones] = useState(false)

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
  }, [company])

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

      const { error } = await supabase
        .from('companies')
        .update({ 
          timezone,
          default_currency: defaultCurrency,
          country_code: normalizedCountry,
          updated_at: new Date().toISOString() 
        })
        .eq('id', company.id)

      if (error) throw error

      await refreshCompany()

      alert(t('alerts.saveSuccess'))
    } catch (error) {
      console.error('Erro ao salvar configurações do sistema:', error)
      alert(t('alerts.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    timezone !== (company?.timezone || 'America/Sao_Paulo') ||
    defaultCurrency !== (company?.default_currency ?? 'BRL') ||
    (normalizedCountry ?? '') !== (companyCountryNorm ?? '')

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

      {/* Botão Salvar */}
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
