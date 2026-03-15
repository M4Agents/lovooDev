// =====================================================
// COMPONENT: USER INPUT FORM
// Data: 15/03/2026
// Objetivo: Formulário para entrada do usuário
// =====================================================

import { useState } from 'react'

interface UserInputFormProps {
  config: {
    question?: string
    variable?: string
    validation?: 'text' | 'number' | 'email' | 'phone'
  }
  onChange: (config: any) => void
}

export default function UserInputForm({ config, onChange }: UserInputFormProps) {
  const [question, setQuestion] = useState(config.question || '')
  const [variable, setVariable] = useState(config.variable || '')
  const [validation, setValidation] = useState(config.validation || 'text')

  const handleChange = (field: string, value: any) => {
    const newConfig = { ...config, [field]: value }
    onChange(newConfig)
  }

  return (
    <div className="space-y-4">
      {/* Pergunta */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Pergunta
        </label>
        <textarea
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value)
            handleChange('question', e.target.value)
          }}
          placeholder="Digite a pergunta que será enviada ao usuário..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          rows={3}
        />
      </div>

      {/* Variável */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Variável para armazenar resposta
        </label>
        <input
          type="text"
          value={variable}
          onChange={(e) => {
            setVariable(e.target.value)
            handleChange('variable', e.target.value)
          }}
          placeholder="Ex: nome_cliente"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="text-xs text-gray-500 mt-1">
          A resposta será salva nesta variável para uso posterior
        </p>
      </div>

      {/* Validação */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tipo de Validação
        </label>
        <select
          value={validation}
          onChange={(e) => {
            setValidation(e.target.value as any)
            handleChange('validation', e.target.value)
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="email">Email</option>
          <option value="phone">Telefone</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          A resposta do usuário será validada conforme o tipo selecionado
        </p>
      </div>
    </div>
  )
}
