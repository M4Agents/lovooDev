import React, { useState, useEffect } from 'react'
import { Plus, X, AlertCircle } from 'lucide-react'
import { SingleCondition, ConditionType } from '../../types/automation'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface ConditionFormProps {
  config: any
  setConfig: (config: any) => void
}

const CONDITION_CATEGORIES = [
  {
    id: 'lead',
    label: 'Lead',
    types: [
      { id: 'lead_field', label: 'Campo do Lead', description: 'Nome, email, telefone, etc.' },
      { id: 'lead_tags', label: 'Tags do Lead', description: 'Verificar tags atribuídas' },
      { id: 'lead_source', label: 'Origem do Lead', description: 'WhatsApp, site, etc.' },
      { id: 'lead_created_date', label: 'Data de Criação', description: 'Quando o lead foi criado' },
      { id: 'last_interaction', label: 'Última Interação', description: 'Tempo desde última mensagem' },
      { id: 'lead_score', label: 'Score do Lead', description: 'Pontuação de qualificação' },
    ]
  },
  {
    id: 'opportunity',
    label: 'Oportunidade',
    types: [
      { id: 'opportunity_stage', label: 'Estágio', description: 'Etapa do funil' },
      { id: 'opportunity_value', label: 'Valor', description: 'Valor da oportunidade' },
      { id: 'opportunity_owner', label: 'Responsável', description: 'Quem é o responsável' },
      { id: 'opportunity_stage_duration', label: 'Tempo no Estágio', description: 'Há quanto tempo está na etapa' },
    ]
  },
  {
    id: 'time',
    label: 'Tempo',
    types: [
      { id: 'day_of_week', label: 'Dia da Semana', description: 'Segunda, terça, etc.' },
      { id: 'time_of_day', label: 'Hora do Dia', description: 'Horário comercial, etc.' },
      { id: 'day_of_month', label: 'Dia do Mês', description: 'Dia 1, 15, último dia, etc.' },
    ]
  }
]

const OPERATORS_BY_TYPE: Record<string, Array<{ value: string, label: string }>> = {
  lead_field: [
    { value: 'equals', label: 'é igual a' },
    { value: 'not_equals', label: 'é diferente de' },
    { value: 'contains', label: 'contém' },
    { value: 'not_contains', label: 'não contém' },
    { value: 'is_empty', label: 'está vazio' },
    { value: 'is_not_empty', label: 'não está vazio' },
  ],
  lead_tags: [
    { value: 'has_tag', label: 'tem a tag' },
    { value: 'not_has_tag', label: 'não tem a tag' },
    { value: 'has_any_tag', label: 'tem qualquer uma das tags' },
    { value: 'has_all_tags', label: 'tem todas as tags' },
  ],
  lead_source: [
    { value: 'equals', label: 'é igual a' },
    { value: 'not_equals', label: 'é diferente de' },
    { value: 'contains', label: 'contém' },
  ],
  lead_created_date: [
    { value: 'is_today', label: 'é hoje' },
    { value: 'is_yesterday', label: 'foi ontem' },
    { value: 'is_this_week', label: 'é esta semana' },
    { value: 'is_this_month', label: 'é este mês' },
    { value: 'is_older_than', label: 'tem mais de' },
    { value: 'is_newer_than', label: 'tem menos de' },
  ],
  last_interaction: [
    { value: 'is_older_than', label: 'foi há mais de' },
    { value: 'is_newer_than', label: 'foi há menos de' },
    { value: 'never_interacted', label: 'nunca interagiu' },
  ],
  lead_score: [
    { value: 'equals', label: 'é igual a' },
    { value: 'greater_than', label: 'é maior que' },
    { value: 'less_than', label: 'é menor que' },
    { value: 'between', label: 'está entre' },
  ],
  opportunity_stage: [
    { value: 'is', label: 'está em' },
    { value: 'is_not', label: 'não está em' },
    { value: 'is_in', label: 'está em qualquer uma' },
  ],
  opportunity_value: [
    { value: 'equals', label: 'é igual a' },
    { value: 'greater_than', label: 'é maior que' },
    { value: 'less_than', label: 'é menor que' },
    { value: 'between', label: 'está entre' },
  ],
  opportunity_owner: [
    { value: 'is', label: 'é' },
    { value: 'is_not', label: 'não é' },
    { value: 'has_no_owner', label: 'não tem responsável' },
  ],
  opportunity_stage_duration: [
    { value: 'is_longer_than', label: 'está há mais de' },
    { value: 'is_shorter_than', label: 'está há menos de' },
  ],
  day_of_week: [
    { value: 'is', label: 'é' },
    { value: 'is_not', label: 'não é' },
    { value: 'is_in', label: 'é um de' },
  ],
  time_of_day: [
    { value: 'is_between', label: 'está entre' },
    { value: 'is_before', label: 'é antes de' },
    { value: 'is_after', label: 'é depois de' },
  ],
  day_of_month: [
    { value: 'is', label: 'é dia' },
    { value: 'is_between', label: 'está entre dia' },
    { value: 'is_first_day', label: 'é primeiro dia do mês' },
    { value: 'is_last_day', label: 'é último dia do mês' },
  ],
}

const LEAD_FIELDS = [
  { value: 'name', label: 'Nome' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefone' },
  { value: 'company_name', label: 'Empresa' },
  { value: 'notes', label: 'Observações' },
]

const DAYS_OF_WEEK = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
]

export function ConditionForm({ config, setConfig }: ConditionFormProps) {
  const { company } = useAuth()
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedType, setSelectedType] = useState<ConditionType | ''>('')
  const [operator, setOperator] = useState<string>('')
  const [value, setValue] = useState<any>('')
  const [field, setField] = useState<string>('')
  const [unit, setUnit] = useState<'hours' | 'days' | 'weeks' | 'months'>('days')
  
  const [tags, setTags] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [funnels, setFunnels] = useState<any[]>([])
  const [stages, setStages] = useState<any[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [selectedFunnel, setSelectedFunnel] = useState<string>('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  useEffect(() => {
    if (config?.type) {
      setSelectedType(config.type)
      setOperator(config.operator || '')
      setValue(config.value || '')
      setField(config.field || '')
      setUnit(config.unit || 'days')
      setSelectedTags(config.tags || [])
    }
  }, [config])

  useEffect(() => {
    if (company?.id) {
      loadTags()
      loadUsers()
      loadFunnels()
      loadSources()
    }
  }, [company?.id])

  useEffect(() => {
    if (selectedFunnel) {
      loadStages(selectedFunnel)
    }
  }, [selectedFunnel])

  const loadTags = async () => {
    try {
      const { data } = await supabase
        .from('lead_tags')
        .select('id, name, color')
        .eq('company_id', company?.id)
        .eq('is_active', true)
        .order('name')
      setTags(data || [])
    } catch (error) {
      console.error('Erro ao carregar tags:', error)
    }
  }

  const loadUsers = async () => {
    try {
      const { data } = await supabase
        .from('company_users')
        .select('user_id, users(id, name, email)')
        .eq('company_id', company?.id)
      setUsers(data?.map((cu: any) => cu.users) || [])
    } catch (error) {
      console.error('Erro ao carregar usuários:', error)
    }
  }

  const loadFunnels = async () => {
    try {
      const { data } = await supabase
        .from('funnels')
        .select('id, name')
        .eq('company_id', company?.id)
        .order('name')
      setFunnels(data || [])
    } catch (error) {
      console.error('Erro ao carregar funis:', error)
    }
  }

  const loadSources = async () => {
    try {
      const { data } = await supabase
        .from('leads')
        .select('source')
        .eq('company_id', company?.id)
        .not('source', 'is', null)
      
      if (data) {
        const uniqueSources = [...new Set(data.map((l: any) => l.source).filter(Boolean))]
        setSources(uniqueSources.sort())
      }
    } catch (error) {
      console.error('Erro ao carregar origens:', error)
    }
  }

  const loadStages = async (funnelId: string) => {
    try {
      const { data } = await supabase
        .from('funnel_stages')
        .select('id, name, position')
        .eq('funnel_id', funnelId)
        .order('position')
      setStages(data || [])
    } catch (error) {
      console.error('Erro ao carregar etapas:', error)
    }
  }

  const handleSave = () => {
    const newConfig: any = {
      type: selectedType,
      operator,
      value,
      field,
      unit,
    }

    if (selectedType === 'lead_tags') {
      newConfig.tags = selectedTags
    }

    setConfig(newConfig)
  }

  const getPreview = () => {
    if (!selectedType || !operator) return 'Configure a condição'

    const typeLabel = CONDITION_CATEGORIES
      .flatMap(cat => cat.types)
      .find(t => t.id === selectedType)?.label || selectedType

    const operatorLabel = OPERATORS_BY_TYPE[selectedType as string]
      ?.find(op => op.value === operator)?.label || operator

    let valueLabel = value

    if (selectedType === 'lead_field' && field) {
      const fieldLabel = LEAD_FIELDS.find(f => f.value === field)?.label || field
      return `Se: ${fieldLabel} ${operatorLabel} "${value}"`
    }

    if (selectedType === 'lead_tags' && selectedTags.length > 0) {
      const tagNames = tags.filter(t => selectedTags.includes(t.id)).map(t => t.name).join(', ')
      return `Se: Lead ${operatorLabel} [${tagNames}]`
    }

    if (selectedType === 'day_of_week' && typeof value === 'number') {
      valueLabel = DAYS_OF_WEEK.find(d => d.value === value)?.label || value
    }

    if (['is_older_than', 'is_newer_than', 'is_longer_than', 'is_shorter_than'].includes(operator)) {
      return `Se: ${typeLabel} ${operatorLabel} ${value} ${unit}`
    }

    return `Se: ${typeLabel} ${operatorLabel} ${valueLabel}`
  }

  const renderValueInput = () => {
    if (!selectedType || !operator) return null

    if (['is_empty', 'is_not_empty', 'never_interacted', 'has_no_owner', 'is_first_day', 'is_last_day', 'is_today', 'is_yesterday', 'is_this_week', 'is_this_month'].includes(operator)) {
      return null
    }

    if (selectedType === 'lead_field') {
      return (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Campo</label>
            <select
              value={field}
              onChange={(e) => setField(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">Selecione o campo...</option>
              {LEAD_FIELDS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Valor</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="Digite o valor..."
            />
          </div>
        </>
      )
    }

    if (selectedType === 'lead_tags') {
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
          <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-300 rounded-md p-2">
            {tags.map(tag => (
              <label key={tag.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedTags([...selectedTags, tag.id])
                    } else {
                      setSelectedTags(selectedTags.filter(id => id !== tag.id))
                    }
                  }}
                  className="rounded border-gray-300"
                />
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-sm">{tag.name}</span>
              </label>
            ))}
          </div>
        </div>
      )
    }

    if (selectedType === 'lead_source') {
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Origem</label>
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">Selecione a origem...</option>
            {sources.map(source => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
          {sources.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">
              Nenhuma origem encontrada. Leads precisam ter origem cadastrada.
            </p>
          )}
        </div>
      )
    }

    if (selectedType === 'opportunity_stage') {
      return (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Funil</label>
            <select
              value={selectedFunnel}
              onChange={(e) => setSelectedFunnel(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">Selecione o funil...</option>
              {funnels.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          {selectedFunnel && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Etapa</label>
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="">Selecione a etapa...</option>
                {stages.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )
    }

    if (selectedType === 'opportunity_owner') {
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Usuário</label>
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">Selecione o usuário...</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      )
    }

    if (selectedType === 'day_of_week') {
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Dia</label>
          <select
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">Selecione o dia...</option>
            {DAYS_OF_WEEK.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      )
    }

    if (selectedType === 'time_of_day') {
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">De</label>
            <input
              type="time"
              value={value?.start || ''}
              onChange={(e) => setValue({ ...value, start: e.target.value })}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Até</label>
            <input
              type="time"
              value={value?.end || ''}
              onChange={(e) => setValue({ ...value, end: e.target.value })}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>
      )
    }

    if (['is_older_than', 'is_newer_than', 'is_longer_than', 'is_shorter_than'].includes(operator)) {
      return (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Quantidade</label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Unidade</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as any)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="hours">Horas</option>
              <option value="days">Dias</option>
              <option value="weeks">Semanas</option>
              <option value="months">Meses</option>
            </select>
          </div>
        </div>
      )
    }

    if (['opportunity_value', 'lead_score'].includes(selectedType as string)) {
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Valor</label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="Digite o valor..."
          />
        </div>
      )
    }

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Valor</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          placeholder="Digite o valor..."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-800">
            <strong>Condições</strong> permitem criar fluxos inteligentes que se adaptam ao contexto de cada lead ou oportunidade.
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Categoria</label>
        <div className="grid grid-cols-3 gap-2">
          {CONDITION_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategory(cat.id)
                setSelectedType('')
                setOperator('')
                setValue('')
              }}
              className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-blue-500 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {selectedCategory && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Condição</label>
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value as ConditionType)
              setOperator('')
              setValue('')
            }}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">Selecione o tipo...</option>
            {CONDITION_CATEGORIES.find(c => c.id === selectedCategory)?.types.map(type => (
              <option key={type.id} value={type.id}>
                {type.label} - {type.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedType && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Operador</label>
          <select
            value={operator}
            onChange={(e) => {
              setOperator(e.target.value)
              setValue('')
            }}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">Selecione o operador...</option>
            {OPERATORS_BY_TYPE[selectedType as string]?.map(op => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
        </div>
      )}

      {operator && renderValueInput()}

      {selectedType && operator && (
        <>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="text-xs font-medium text-gray-500 mb-1">Preview:</div>
            <div className="text-sm text-gray-900">{getPreview()}</div>
          </div>

          <button
            onClick={handleSave}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            Aplicar Condição
          </button>
        </>
      )}
    </div>
  )
}
