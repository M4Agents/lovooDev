import React, { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { Clock, Save } from 'lucide-react'
import { TimezoneSelector } from './TimezoneSelector'

// Timezones mais comuns para seleção rápida
const COMMON_TIMEZONES = [
  // Brasil
  { value: 'America/Sao_Paulo', label: '🇧🇷 Brasil - São Paulo (UTC-3)', region: 'Brasil' },
  { value: 'America/Manaus', label: '🇧🇷 Brasil - Manaus (UTC-4)', region: 'Brasil' },
  { value: 'America/Fortaleza', label: '🇧🇷 Brasil - Fortaleza (UTC-3)', region: 'Brasil' },
  
  // América Latina
  { value: 'America/Argentina/Buenos_Aires', label: '🇦🇷 Argentina - Buenos Aires (UTC-3)', region: 'América Latina' },
  { value: 'America/Santiago', label: '🇨🇱 Chile - Santiago (UTC-3)', region: 'América Latina' },
  { value: 'America/Lima', label: '🇵🇪 Peru - Lima (UTC-5)', region: 'América Latina' },
  { value: 'America/Bogota', label: '🇨🇴 Colômbia - Bogotá (UTC-5)', region: 'América Latina' },
  { value: 'America/Mexico_City', label: '🇲🇽 México - Cidade do México (UTC-6)', region: 'América Latina' },
  
  // América do Norte
  { value: 'America/New_York', label: '🇺🇸 EUA - Nova York (UTC-5)', region: 'América do Norte' },
  { value: 'America/Chicago', label: '🇺🇸 EUA - Chicago (UTC-6)', region: 'América do Norte' },
  { value: 'America/Los_Angeles', label: '🇺🇸 EUA - Los Angeles (UTC-8)', region: 'América do Norte' },
  { value: 'America/Toronto', label: '🇨🇦 Canadá - Toronto (UTC-5)', region: 'América do Norte' },
  
  // Europa
  { value: 'Europe/Lisbon', label: '🇵🇹 Portugal - Lisboa (UTC+0)', region: 'Europa' },
  { value: 'Europe/Madrid', label: '🇪🇸 Espanha - Madrid (UTC+1)', region: 'Europa' },
  { value: 'Europe/Paris', label: '🇫🇷 França - Paris (UTC+1)', region: 'Europa' },
  { value: 'Europe/London', label: '🇬🇧 Reino Unido - Londres (UTC+0)', region: 'Europa' },
  { value: 'Europe/Berlin', label: '🇩🇪 Alemanha - Berlim (UTC+1)', region: 'Europa' },
  { value: 'Europe/Rome', label: '🇮🇹 Itália - Roma (UTC+1)', region: 'Europa' },
  
  // Ásia
  { value: 'Asia/Tokyo', label: '🇯🇵 Japão - Tóquio (UTC+9)', region: 'Ásia' },
  { value: 'Asia/Shanghai', label: '🇨🇳 China - Xangai (UTC+8)', region: 'Ásia' },
  { value: 'Asia/Dubai', label: '🇦🇪 Emirados Árabes - Dubai (UTC+4)', region: 'Ásia' },
  { value: 'Asia/Singapore', label: '🇸🇬 Singapura (UTC+8)', region: 'Ásia' },
  
  // Oceania
  { value: 'Australia/Sydney', label: '🇦🇺 Austrália - Sydney (UTC+10)', region: 'Oceania' },
  { value: 'Pacific/Auckland', label: '🇳🇿 Nova Zelândia - Auckland (UTC+12)', region: 'Oceania' },
]

export const SystemSettings: React.FC = () => {
  const { company, refreshCompany } = useAuth()
  const [timezone, setTimezone] = useState(company?.timezone || 'America/Sao_Paulo')
  const [saving, setSaving] = useState(false)
  const [showAllTimezones, setShowAllTimezones] = useState(false)

  const handleSave = async () => {
    if (!company?.id) {
      alert('❌ Erro: Empresa não encontrada')
      return
    }

    try {
      setSaving(true)

      const { error } = await supabase
        .from('companies')
        .update({ 
          timezone,
          updated_at: new Date().toISOString() 
        })
        .eq('id', company.id)

      if (error) throw error

      // Atualizar contexto
      await refreshCompany()

      alert('✅ Fuso horário atualizado com sucesso!\n\nRecarregue a página para aplicar as mudanças.')
    } catch (error) {
      console.error('Erro ao salvar timezone:', error)
      alert('❌ Erro ao salvar configurações')
    } finally {
      setSaving(false)
    }
  }

  // Agrupar timezones comuns por região
  const groupedCommonTimezones = COMMON_TIMEZONES.reduce((groups, tz) => {
    if (!groups[tz.region]) {
      groups[tz.region] = []
    }
    groups[tz.region].push(tz)
    return groups
  }, {} as Record<string, typeof COMMON_TIMEZONES>)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Clock className="w-6 h-6 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">Configuração de Fuso Horário</h3>
        </div>
        <p className="text-sm text-gray-600">
          Defina o fuso horário da sua empresa. Todas as datas e horários do sistema serão exibidos neste fuso.
        </p>
      </div>

      {/* Seletor de Timezone */}
      {!showAllTimezones ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            ⭐ Fusos Horários Mais Comuns
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
            🌍 Ver todos os fusos horários do mundo
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              🌍 Todos os Fusos Horários
            </label>
            <button
              onClick={() => setShowAllTimezones(false)}
              className="text-sm text-gray-600 hover:text-gray-700 font-medium"
            >
              ← Voltar para sugestões
            </button>
          </div>

          <TimezoneSelector value={timezone} onChange={setTimezone} />
        </div>
      )}

      {/* Preview do Horário Atual */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-4">
        <p className="text-sm font-medium text-gray-700 mb-2">
          🕐 Horário Atual no Fuso Selecionado:
        </p>
        <p className="text-2xl font-bold text-indigo-900">
          {new Date().toLocaleString('pt-BR', { 
            timeZone: timezone,
            dateStyle: 'full',
            timeStyle: 'long'
          })}
        </p>
        <p className="text-xs text-gray-600 mt-2">
          Timezone: <code className="bg-white px-2 py-0.5 rounded">{timezone}</code>
        </p>
      </div>

      {/* Informação Importante */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>ℹ️ Informação:</strong> Após alterar o fuso horário, todas as datas e horários 
          do sistema serão exibidos no novo fuso. Os dados no banco de dados permanecem em UTC 
          (padrão internacional). Recarregue a página após salvar para aplicar as mudanças.
        </p>
      </div>

      {/* Botão Salvar */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || timezone === company?.timezone}
          className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Salvando...' : 'Salvar Configurações'}
        </button>

        {timezone !== company?.timezone && (
          <button
            onClick={() => setTimezone(company?.timezone || 'America/Sao_Paulo')}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}
