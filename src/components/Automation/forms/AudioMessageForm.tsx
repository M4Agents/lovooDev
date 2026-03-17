// =====================================================
// COMPONENT: AUDIO MESSAGE FORM
// Data: 15/03/2026
// Objetivo: Formulário para mensagem de áudio
// =====================================================

import { useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import AudioRecorder from '../AudioRecorder'
import { ensureAudiosFolderExists, uploadToLibrary } from '../../../utils/mediaLibraryHelpers'
import { useAuth } from '../../../contexts/AuthContext'

interface AudioMessageFormProps {
  config: {
    audioFile?: File
    audioUrl?: string
    libraryFileId?: string
  }
  onChange: (config: any) => void
}

export default function AudioMessageForm({ config, onChange }: AudioMessageFormProps) {
  const { user } = useAuth()
  const [audioUrl, setAudioUrl] = useState(config.audioUrl || '')
  const [fileName, setFileName] = useState('')
  const [recordedFile, setRecordedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(file.name)
      onChange({ ...config, audioFile: file, audioUrl: '' })
    }
  }

  const handleUrlChange = (value: string) => {
    setAudioUrl(value)
    onChange({ ...config, audioUrl: value, audioFile: undefined, libraryFileId: undefined })
  }

  const handleRecordingComplete = async (file: File) => {
    try {
      setIsUploading(true)
      setUploadError(null)
      
      if (!user?.companyId) {
        throw new Error('Company ID não encontrado')
      }
      
      console.log('🎙️ Áudio gravado, iniciando upload:', file.name)
      
      // 1. Garantir que pasta Audios existe
      const audiosFolderId = await ensureAudiosFolderExists(user.companyId)
      console.log('📁 Pasta Audios garantida:', audiosFolderId)
      
      // 2. Upload para biblioteca
      const uploadResult = await uploadToLibrary(file, user.companyId, audiosFolderId)
      
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Erro no upload')
      }
      
      console.log('✅ Upload concluído:', uploadResult)
      
      // 3. Salvar no config
      setRecordedFile(file)
      setFileName(file.name)
      setAudioUrl('')  // Limpar URL manual
      
      onChange({ 
        ...config, 
        audioFile: file,
        audioUrl: uploadResult.mediaUrl,
        libraryFileId: uploadResult.fileId
      })
      
    } catch (error) {
      console.error('❌ Erro ao salvar áudio:', error)
      setUploadError(error instanceof Error ? error.message : 'Erro ao salvar áudio')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Gravação de Áudio */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Gravar Áudio
        </label>
        <AudioRecorder 
          onRecordingComplete={handleRecordingComplete}
          maxDuration={300}
          disabled={isUploading}
        />
        
        {isUploading && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              <span className="text-sm text-blue-700">
                Salvando áudio na biblioteca...
              </span>
            </div>
          </div>
        )}
        
        {uploadError && (
          <div className="mt-3 p-3 bg-red-50 rounded-lg">
            <p className="text-sm text-red-700">
              ❌ {uploadError}
            </p>
          </div>
        )}
        
        {recordedFile && !isUploading && (
          <div className="mt-3 p-3 bg-green-50 rounded-lg">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium text-green-700 mb-2">
                  ✅ Áudio gravado e salvo na biblioteca
                </p>
                <p className="text-xs text-green-600 mb-2">
                  {fileName}
                </p>
                <audio 
                  src={URL.createObjectURL(recordedFile)} 
                  controls 
                  className="w-full h-8"
                  style={{ maxHeight: '32px' }}
                />
              </div>
            </div>
          </div>
        )}
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
