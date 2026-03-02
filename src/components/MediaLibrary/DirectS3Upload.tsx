// =====================================================
// DIRECT S3 UPLOAD - NOVO COMPONENTE
// =====================================================
// Componente criado especificamente para contornar cache
// Usa S3Storage direto (mesma estrutura do Chat)
// Data: 2026-02-22 11:54

import React from 'react'
import { Upload } from 'lucide-react'

interface DirectS3UploadProps {
  companyId: string
  folderId?: string
  onUploadComplete: (fileId: string) => void
  showDragDrop?: boolean // Mostrar área de drag & drop expandida
}

export const DirectS3Upload: React.FC<DirectS3UploadProps> = ({
  companyId,
  folderId,
  onUploadComplete,
  showDragDrop = false
}) => {
  const [isUploading, setIsUploading] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)

  const processFile = async (file: File) => {

    console.log('🚀🚀🚀 DIRECT S3 UPLOAD - NOVO COMPONENTE - 2026-02-22 11:54 🚀🚀🚀')
    console.log('📁 Arquivo selecionado:', file.name)
    console.log('📊 Tamanho:', file.size, 'bytes')

    // Validar tamanho do arquivo ANTES do upload
    const maxSizes = {
      image: 10 * 1024 * 1024,    // 10MB
      video: 25 * 1024 * 1024,    // 25MB
      audio: 25 * 1024 * 1024,    // 25MB
      document: 25 * 1024 * 1024  // 25MB
    }

    let fileType: 'image' | 'video' | 'audio' | 'document' = 'document'
    if (file.type.startsWith('image/')) fileType = 'image'
    else if (file.type.startsWith('video/')) fileType = 'video'
    else if (file.type.startsWith('audio/')) fileType = 'audio'

    const maxSize = maxSizes[fileType]
    if (file.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024))
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
      setError(`⚠️ Arquivo muito grande!\nMáximo permitido: ${maxSizeMB}MB para ${fileType === 'image' ? 'fotos' : fileType === 'video' ? 'vídeos' : 'arquivos'}\nTamanho do seu arquivo: ${fileSizeMB}MB\n\n💡 Dica: Comprima o arquivo antes de enviar`)
      return
    }

    setIsUploading(true)
    setError(null)
    setProgress(0)

    try {
      // 1. Converter File para Buffer
      console.log('🔧 Convertendo arquivo para buffer...')
      const arrayBuffer = await file.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      setProgress(10)

      // 2. Importar S3Storage (mesma classe do Chat)
      console.log('🔧 Importando S3Storage...')
      const { S3Storage } = await import('../../services/aws/s3Storage')
      setProgress(20)

      // 3. Detectar content type
      const contentType = S3Storage.detectContentType(buffer, file.name)
      console.log('🔍 Content type detectado:', contentType)
      setProgress(30)

      // 4. Gerar messageId único
      const messageId = `biblioteca-direct-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      setProgress(40)

      // 5. Upload DIRETO para S3
      console.log('🚀 Fazendo upload direto para S3...')
      const uploadResult = await S3Storage.uploadToS3({
        companyId: companyId,
        messageId: messageId,
        originalFileName: file.name,
        buffer: buffer,
        contentType: contentType,
        source: 'biblioteca'
      })
      setProgress(70)

      if (!uploadResult.success || !uploadResult.data) {
        throw new Error(uploadResult.error || 'Upload S3 falhou')
      }

      console.log('✅ Upload S3 concluído:', uploadResult.data.s3Key)

      // 6. Gerar Signed URL
      console.log('🔗 Gerando signed URL...')
      const signedUrlResult = await S3Storage.generateSignedUrl(
        companyId,
        uploadResult.data.s3Key,
        { expiresIn: 7200 }
      )
      setProgress(80)

      if (!signedUrlResult.success || !signedUrlResult.data) {
        throw new Error(signedUrlResult.error || 'Falha ao gerar signed URL')
      }

      console.log('✅ Signed URL gerada')

      // 7. Salvar metadados via API backend (bypassa RLS com service role)
      console.log('💾 Salvando metadados via API backend...')

      const metadataPayload = {
        company_id: companyId,
        original_filename: file.name,
        file_type: fileType,
        mime_type: file.type,
        file_size: file.size,
        s3_key: uploadResult.data.s3Key,
        preview_url: signedUrlResult.data,
        folder_id: folderId || null
      }

      const metadataResponse = await fetch('/api/media-library/save-metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadataPayload)
      })

      if (!metadataResponse.ok) {
        const errorData = await metadataResponse.json()
        console.error('❌ Erro ao salvar metadados via API:', errorData)
        throw new Error(errorData.error || 'Falha ao salvar metadados')
      }

      const metadataResult = await metadataResponse.json()
      
      if (!metadataResult.success) {
        console.error('❌ API retornou erro:', metadataResult.error)
        throw new Error(metadataResult.error || 'Falha ao salvar metadados')
      }

      setProgress(100)
      console.log('✅ Upload completo! ID:', metadataResult.data.id)
      console.log('✅ METADADOS SALVOS NO BANCO VIA API BACKEND!')
      console.log('📊 Dados salvos:', {
        id: metadataResult.data.id,
        s3_key: metadataResult.data.s3_key,
        folder_id: metadataResult.data.folder_id
      })

      // Chamar callback de sucesso
      onUploadComplete(metadataResult.data.id)

    } catch (err) {
      console.error('❌ Erro no upload direto S3:', err)
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await processFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const file = e.dataTransfer.files?.[0]
    if (!file) return
    await processFile(file)
  }

  // Renderização condicional: drag & drop expandido ou botão compacto
  if (showDragDrop) {
    return (
      <div className="space-y-2">
        <input
          type="file"
          id="direct-s3-upload"
          className="hidden"
          onChange={handleFileSelect}
          disabled={isUploading}
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
        />
        
        <label
          htmlFor="direct-s3-upload"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`block w-full p-8 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
            isDragOver
              ? 'border-green-500 bg-green-50'
              : 'border-gray-300 bg-gray-50 hover:border-green-400 hover:bg-green-50'
          } ${
            isUploading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <div className="flex flex-col items-center justify-center text-center">
            <Upload className="w-12 h-12 text-gray-400 mb-3" />
            <p className="text-base font-medium text-gray-700 mb-1">
              {isUploading ? `Enviando... ${progress}%` : 'Arraste e solte seu arquivo aqui'}
            </p>
            <p className="text-sm text-gray-500">
              ou clique para selecionar
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Imagens, vídeos, áudios e documentos
            </p>
            <p className="text-xs text-gray-500 mt-1">
              📏 Limites: Fotos 10MB • Vídeos 25MB • Arquivos 25MB
            </p>
          </div>
        </label>

        {isUploading && (
          <div className="bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>
    )
  }

  // Versão compacta (para chat)
  return (
    <div className="space-y-2">
      <input
        type="file"
        id="direct-s3-upload"
        className="hidden"
        onChange={handleFileSelect}
        disabled={isUploading}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
      />
      
      <label
        htmlFor="direct-s3-upload"
        className={`w-full py-3 px-4 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors ${
          isUploading ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <Upload className="w-5 h-5" />
        <span>{isUploading ? `Enviando... ${progress}%` : 'Fazer Upload'}</span>
      </label>

      {isUploading && (
        <div className="bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  )
}
