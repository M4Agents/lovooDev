// =====================================================
// COMPONENT: FILE ATTACHMENT FORM
// Data: 15/03/2026
// Objetivo: Formulário para arquivo anexo
// =====================================================

import { useState } from 'react'
import { Upload } from 'lucide-react'

interface FileAttachmentFormProps {
  config: {
    fileType?: 'image' | 'document' | 'video'
    file?: File
    fileUrl?: string
    caption?: string
  }
  onChange: (config: any) => void
}

export default function FileAttachmentForm({ config, onChange }: FileAttachmentFormProps) {
  const [fileType, setFileType] = useState(config.fileType || 'image')
  const [fileUrl, setFileUrl] = useState(config.fileUrl || '')
  const [caption, setCaption] = useState(config.caption || '')
  const [fileName, setFileName] = useState('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(file.name)
      onChange({ ...config, file, fileUrl: '', fileType, caption })
    }
  }

  const handleChange = (field: string, value: any) => {
    const newConfig = { ...config, [field]: value }
    onChange(newConfig)
  }

  const getAcceptTypes = () => {
    switch (fileType) {
      case 'image':
        return 'image/*'
      case 'video':
        return 'video/*'
      case 'document':
        return '.pdf,.doc,.docx,.xls,.xlsx,.txt'
      default:
        return '*'
    }
  }

  return (
    <div className="space-y-4">
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
          <option value="image">Imagem</option>
          <option value="document">Documento</option>
          <option value="video">Vídeo</option>
        </select>
      </div>

      {/* Upload de Arquivo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Arquivo
        </label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
          <input
            type="file"
            accept={getAcceptTypes()}
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center gap-2"
          >
            <Upload className="w-8 h-8 text-gray-400" />
            <div className="text-sm text-gray-600">
              {fileName || 'Clique para selecionar arquivo'}
            </div>
            <div className="text-xs text-gray-500">
              {fileType === 'image' && 'JPG, PNG, GIF (máx. 5MB)'}
              {fileType === 'video' && 'MP4, AVI (máx. 16MB)'}
              {fileType === 'document' && 'PDF, DOC, XLS (máx. 10MB)'}
            </div>
          </label>
        </div>
      </div>

      {/* Divisor */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-gray-500">ou</span>
        </div>
      </div>

      {/* URL do Arquivo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          URL do Arquivo
        </label>
        <input
          type="url"
          value={fileUrl}
          onChange={(e) => {
            setFileUrl(e.target.value)
            handleChange('fileUrl', e.target.value)
          }}
          placeholder="https://exemplo.com/arquivo.pdf"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Legenda */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Legenda (opcional)
        </label>
        <textarea
          value={caption}
          onChange={(e) => {
            setCaption(e.target.value)
            handleChange('caption', e.target.value)
          }}
          placeholder="Digite uma legenda para o arquivo..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          rows={2}
        />
      </div>
    </div>
  )
}
