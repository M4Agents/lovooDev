// =====================================================
// COMPONENT: DYNAMIC URL FORM
// Data: 15/03/2026
// Objetivo: Formulário para arquivo URL dinâmica
// =====================================================

import { useState } from 'react'

interface DynamicUrlFormProps {
  config: {
    url?: string
    fileType?: 'auto' | 'image' | 'document' | 'video' | 'audio'
  }
  onChange: (config: any) => void
}

export default function DynamicUrlForm({ config, onChange }: DynamicUrlFormProps) {
  const [url, setUrl] = useState(config.url || '')
  const [fileType, setFileType] = useState(config.fileType || 'auto')

  const handleChange = (field: string, value: any) => {
    const newConfig = { ...config, [field]: value }
    onChange(newConfig)
  }

  return (
    <div className="space-y-4">
      {/* URL do Arquivo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          URL do Arquivo
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            handleChange('url', e.target.value)
          }}
          placeholder="https://exemplo.com/arquivo.pdf"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
          <p className="font-medium mb-1">💡 Use variáveis dinâmicas:</p>
          <code className="bg-white px-1 py-0.5 rounded">{`{{nome_variavel}}`}</code>
          <p className="mt-1">Exemplo: <code className="bg-white px-1 py-0.5 rounded">{`https://api.com/files/{{id_cliente}}.pdf`}</code></p>
        </div>
      </div>

      {/* Tipo de Arquivo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tipo de Arquivo
        </label>
        <select
          value={fileType}
          onChange={(e) => {
            setFileType(e.target.value as any)
            handleChange('fileType', e.target.value)
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="auto">Detectar automaticamente</option>
          <option value="image">Imagem</option>
          <option value="document">Documento</option>
          <option value="video">Vídeo</option>
          <option value="audio">Áudio</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          O sistema tentará detectar o tipo baseado na extensão do arquivo
        </p>
      </div>

      {/* Informações */}
      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <p className="text-xs text-gray-700">
          <strong>ℹ️ Como funciona:</strong>
        </p>
        <ul className="text-xs text-gray-600 mt-2 space-y-1 list-disc list-inside">
          <li>A URL será processada substituindo as variáveis pelos valores reais</li>
          <li>O arquivo será baixado e enviado ao usuário</li>
          <li>Certifique-se que a URL é acessível publicamente</li>
        </ul>
      </div>
    </div>
  )
}
