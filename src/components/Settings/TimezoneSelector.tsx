import React, { useState, useMemo } from 'react'
import { Search } from 'lucide-react'

interface TimezoneOption {
  value: string
  label: string
  region: string
  offset: string
  offsetMinutes: number
}

interface TimezoneSelectorProps {
  value: string
  onChange: (timezone: string) => void
}

export const TimezoneSelector: React.FC<TimezoneSelectorProps> = ({ value, onChange }) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedRegion, setSelectedRegion] = useState<string>('all')

  // Obter todos os timezones disponíveis
  const allTimezones = useMemo(() => {
    try {
      const timezones = Intl.supportedValuesOf('timeZone')
      
      return timezones.map(tz => {
        const now = new Date()
        
        // Extrair região e cidade
        const [region, ...cityParts] = tz.split('/')
        const city = cityParts.join('/').replace(/_/g, ' ')
        
        // Calcular offset
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'longOffset'
        })
        
        const parts = formatter.formatToParts(now)
        const offsetPart = parts.find(p => p.type === 'timeZoneName')
        const offset = offsetPart?.value || 'UTC'
        
        // Calcular offset em minutos para ordenação
        const localDate = new Date(now.toLocaleString('en-US', { timeZone: tz }))
        const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
        const offsetMinutes = (localDate.getTime() - utcDate.getTime()) / (1000 * 60)
        
        return {
          value: tz,
          label: `${city} (${offset})`,
          region: region,
          offset: offset,
          offsetMinutes: offsetMinutes
        }
      }).sort((a, b) => {
        // Ordenar por offset primeiro, depois por nome
        if (a.offsetMinutes !== b.offsetMinutes) {
          return b.offsetMinutes - a.offsetMinutes
        }
        return a.label.localeCompare(b.label)
      })
    } catch (error) {
      console.error('Erro ao carregar timezones:', error)
      return []
    }
  }, [])

  // Filtrar timezones
  const filteredTimezones = useMemo(() => {
    return allTimezones.filter(tz => {
      // Filtro por região
      if (selectedRegion !== 'all' && tz.region !== selectedRegion) {
        return false
      }
      
      // Filtro por busca
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        return (
          tz.label.toLowerCase().includes(search) ||
          tz.value.toLowerCase().includes(search) ||
          tz.offset.toLowerCase().includes(search)
        )
      }
      
      return true
    })
  }, [allTimezones, searchTerm, selectedRegion])

  // Agrupar por região
  const groupedTimezones = useMemo(() => {
    const groups: Record<string, TimezoneOption[]> = {}
    
    filteredTimezones.forEach(tz => {
      if (!groups[tz.region]) {
        groups[tz.region] = []
      }
      groups[tz.region].push(tz)
    })
    
    return groups
  }, [filteredTimezones])

  const regions = [
    { value: 'all', label: 'Todos os Continentes', icon: '🌍' },
    { value: 'America', label: 'América', icon: '🌎' },
    { value: 'Europe', label: 'Europa', icon: '🇪🇺' },
    { value: 'Asia', label: 'Ásia', icon: '🌏' },
    { value: 'Africa', label: 'África', icon: '🌍' },
    { value: 'Pacific', label: 'Pacífico', icon: '🌊' },
    { value: 'Australia', label: 'Austrália', icon: '🦘' },
    { value: 'Atlantic', label: 'Atlântico', icon: '🌊' },
    { value: 'Indian', label: 'Índico', icon: '🌊' },
    { value: 'Antarctica', label: 'Antártida', icon: '🐧' },
  ]

  const regionIcons: Record<string, string> = {
    'America': '🌎',
    'Europe': '🇪🇺',
    'Asia': '🌏',
    'Africa': '🌍',
    'Pacific': '🌊',
    'Australia': '🦘',
    'Atlantic': '🌊',
    'Indian': '🌊',
    'Antarctica': '🐧',
  }

  return (
    <div className="space-y-4">
      {/* Busca */}
      <div className="relative">
        <input
          type="text"
          placeholder="🔍 Buscar por cidade, país ou offset (ex: UTC-3, São Paulo, Brasil)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
      </div>

      {/* Filtro por Região */}
      <div className="flex gap-2 flex-wrap">
        {regions.map(region => (
          <button
            key={region.value}
            onClick={() => setSelectedRegion(region.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              selectedRegion === region.value
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {region.icon} {region.label}
          </button>
        ))}
      </div>

      {/* Lista de Timezones */}
      <div className="border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
        {Object.entries(groupedTimezones).length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Nenhum fuso horário encontrado
          </div>
        ) : (
          Object.entries(groupedTimezones).map(([region, timezones]) => (
            <div key={region}>
              <div className="sticky top-0 bg-gray-50 px-4 py-2 font-semibold text-sm text-gray-700 border-b border-gray-200">
                {regionIcons[region] || '🌍'} {region} ({timezones.length})
              </div>
              {timezones.map(tz => (
                <button
                  key={tz.value}
                  onClick={() => onChange(tz.value)}
                  className={`w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                    value === tz.value ? 'bg-indigo-50 border-indigo-200' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${value === tz.value ? 'text-indigo-700' : 'text-gray-900'}`}>
                      {tz.label}
                    </span>
                    <span className="text-xs text-gray-500">{tz.value}</span>
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Info */}
      <div className="text-sm text-gray-600">
        Mostrando {filteredTimezones.length} de {allTimezones.length} fusos horários
      </div>
    </div>
  )
}
