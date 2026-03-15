// =====================================================
// COMPONENT: AUDIO MESSAGE FORM
// Data: 15/03/2026
// Objetivo: Formulário para mensagem de áudio
// =====================================================

import { useState } from 'react'
import { Upload } from 'lucide-react'

interface AudioMessageFormProps {
  config: {
    audioFile?: File
    audioUrl?: string
  }
  onChange: (config: any) => void
}

export default function AudioMessageForm({ config, onChange }: AudioMessageFormProps) {
  const [audioUrl, setAudioUrl] = useState(config.audioUrl || '')
  const [fileName, setFileName] = useState('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(file.name)
      onChange({ ...config, audioFile: file, audioUrl: '' })
    }
  }

  const handleUrlChange = (value: string) => {
    setAudioUrl(value)
    onChange({ ...config, audioUrl: value, audioFile: undefined })
  }

  return (
    <div className="space-y-4">
      {/* Upload de Arquivo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Arquivo de Áudio
        </label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
            id="audio-upload"
          />
          <label
            htmlFor="audio-upload"
            className="cursor-pointer flex flex-col items-center gap-2"
          >
            <Upload className="w-8 h-8 text-gray-400" />
            <div className="text-sm text-gray-600">
              {fileName || 'Clique para selecionar arquivo de áudio'}
            </div>
            <div className="text-xs text-gray-500">
              MP3, WAV, OGG (máx. 16MB)
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

      {/* URL do Áudio */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          URL do Áudio
        </label>
        <input
          type="url"
          value={audioUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://exemplo.com/audio.mp3"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="text-xs text-gray-500 mt-1">
          Cole a URL de um arquivo de áudio hospedado
        </p>
      </div>
    </div>
  )
}
