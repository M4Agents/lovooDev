// =====================================================
// InstagramMessageInput
// =====================================================
// Área de input do chat Instagram.
// Funcionalidades:
//   - Emoji picker (@emoji-mart/react)
//   - Upload de imagem/vídeo (Supabase Storage)
//   - Gravação de áudio (MediaRecorder → Supabase Storage)
//   - Sugestão de resposta por IA (InstagramSuggestionPanel)
//   - Barra de reply
// NÃO altera nenhum componente WhatsApp.
// =====================================================

import React, { useRef, useEffect, useState, useCallback } from 'react'
import Picker from '@emoji-mart/react'
import data   from '@emoji-mart/data'
import { supabase } from '../../../lib/supabase'
import type { InstagramChatMessage, InstagramSendMediaPayload } from '../../../types/instagram-chat'
import { InstagramSuggestionPanel } from './InstagramSuggestionPanel'

// =====================================================
// CONSTANTES
// =====================================================

const MAX_FILE_MB    = 25
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
const STORAGE_BUCKET = 'instagram-media'

const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ACCEPTED_VIDEOS = ['video/mp4', 'video/quicktime']
const ACCEPTED_AUDIO  = ['audio/ogg', 'audio/mpeg', 'audio/webm']

function getMediaType(mime: string): 'image' | 'video' | 'audio' | null {
  if (ACCEPTED_IMAGES.includes(mime)) return 'image'
  if (ACCEPTED_VIDEOS.includes(mime)) return 'video'
  if (ACCEPTED_AUDIO.includes(mime))  return 'audio'
  return null
}

// =====================================================
// TIPOS
// =====================================================

export interface InstagramMessageInputProps {
  conversationId: string
  companyId: string
  sendLoading: boolean
  sendMediaLoading: boolean
  connectionActive: boolean
  replyingTo: InstagramChatMessage | null
  onSetReplyingTo: (msg: InstagramChatMessage | null) => void
  onSend: (text: string, replyToIgMessageId?: string | null) => Promise<void>
  onSendMedia: (payload: InstagramSendMediaPayload) => Promise<void>
}

// =====================================================
// HELPERS
// =====================================================

function sanitizeStorageKey(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[^a-zA-Z0-9._-]/g, '_') // substitui caracteres inválidos
    .replace(/_+/g, '_')               // colapsa underscores múltiplos
    .replace(/^_|_$/g, '')             // remove underscore inicial/final
}

async function uploadToStorage(
  file: File | Blob,
  companyId: string,
  conversationId: string,
  filename: string
): Promise<string> {
  const safeFilename = sanitizeStorageKey(filename)
  const path = `${companyId}/${conversationId}/${Date.now()}_${safeFilename}`
  const { data: uploadData, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw new Error(`Upload falhou: ${error.message}`)

  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(uploadData.path)

  return publicUrl
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const InstagramMessageInput: React.FC<InstagramMessageInputProps> = ({
  conversationId,
  companyId,
  sendLoading,
  sendMediaLoading,
  connectionActive,
  replyingTo,
  onSetReplyingTo,
  onSend,
  onSendMedia,
}) => {
  const [text, setText]                     = useState('')
  const [isEmojiOpen, setIsEmojiOpen]       = useState(false)
  const [isSuggestionOpen, setIsSuggestion] = useState(false)
  const [isRecording, setIsRecording]       = useState(false)
  const [uploadError, setUploadError]       = useState<string | null>(null)
  const [mediaPreview, setMediaPreview]     = useState<{ file: File; url: string } | null>(null)
  const [isUploading, setIsUploading]       = useState(false)

  const inputRef       = useRef<HTMLTextAreaElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const mediaRecorder  = useRef<MediaRecorder | null>(null)
  const audioChunks    = useRef<Blob[]>([])

  const isSending = sendLoading || sendMediaLoading || isUploading

  // Focar input ao ativar reply
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus()
  }, [replyingTo])

  // Fechar emoji picker ao clicar fora
  useEffect(() => {
    if (!isEmojiOpen) return
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setIsEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isEmojiOpen])

  // ── Send text ────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isSending || !connectionActive) return
    setText('')
    setIsEmojiOpen(false)
    await onSend(trimmed, replyingTo?.ig_message_id ?? null)
  }, [text, isSending, connectionActive, onSend, replyingTo])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape' && replyingTo) onSetReplyingTo(null)
  }

  // ── Emoji picker ─────────────────────────────────────

  const handleSelectEmoji = useCallback((emoji: { native?: string }) => {
    if (!emoji.native) return
    const el = inputRef.current
    if (!el) { setText(t => t + emoji.native); return }
    const start = el.selectionStart ?? text.length
    const end   = el.selectionEnd   ?? text.length
    const next  = text.slice(0, start) + emoji.native + text.slice(end)
    setText(next)
    // Reposicionar cursor
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + emoji.native!.length, start + emoji.native!.length)
    })
  }, [text])

  // ── File upload ──────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!e.target.value) return
    e.target.value = ''

    if (!file) return
    setUploadError(null)

    if (file.size > MAX_FILE_BYTES) {
      setUploadError(`Arquivo muito grande. Máximo: ${MAX_FILE_MB} MB`)
      return
    }

    const mediaType = getMediaType(file.type)
    if (!mediaType) {
      setUploadError('Formato não suportado. Use: JPG, PNG, GIF, MP4, OGG, MP3')
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setMediaPreview({ file, url: objectUrl })
  }, [])

  const handleSendMedia = useCallback(async () => {
    if (!mediaPreview || isSending || !connectionActive) return
    setIsUploading(true)
    setUploadError(null)
    try {
      const mediaType = getMediaType(mediaPreview.file.type)!
      const publicUrl = await uploadToStorage(mediaPreview.file, companyId, conversationId, mediaPreview.file.name)
      await onSendMedia({
        media_url:              publicUrl,
        media_type:             mediaType,
        reply_to_ig_message_id: replyingTo?.ig_message_id ?? null,
      })
      URL.revokeObjectURL(mediaPreview.url)
      setMediaPreview(null)
    } catch (err: any) {
      setUploadError(err.message ?? 'Erro ao enviar arquivo')
    } finally {
      setIsUploading(false)
    }
  }, [mediaPreview, isSending, connectionActive, companyId, conversationId, onSendMedia, replyingTo])

  const cancelMediaPreview = useCallback(() => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview.url)
    setMediaPreview(null)
    setUploadError(null)
  }, [mediaPreview])

  // ── Audio recording ──────────────────────────────────

  const startRecording = useCallback(async () => {
    if (isRecording) return
    setUploadError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                     : MediaRecorder.isTypeSupported('audio/ogg')  ? 'audio/ogg'
                     : 'audio/mpeg'

      const recorder = new MediaRecorder(stream, { mimeType })
      audioChunks.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunks.current, { type: mimeType })
        if (blob.size === 0) return

        setIsUploading(true)
        try {
          const ext      = mimeType.split('/')[1]
          const publicUrl = await uploadToStorage(blob, companyId, conversationId, `audio_${Date.now()}.${ext}`)
          await onSendMedia({
            media_url:              publicUrl,
            media_type:             'audio',
            reply_to_ig_message_id: replyingTo?.ig_message_id ?? null,
          })
        } catch (err: any) {
          setUploadError(err.message ?? 'Erro ao enviar áudio')
        } finally {
          setIsUploading(false)
        }
      }
      recorder.start()
      mediaRecorder.current = recorder
      setIsRecording(true)
    } catch {
      setUploadError('Permissão de microfone negada ou indisponível.')
    }
  }, [isRecording, companyId, conversationId, onSendMedia, replyingTo])

  const stopRecording = useCallback(() => {
    mediaRecorder.current?.stop()
    setIsRecording(false)
  }, [])

  // ── AI suggestion apply ──────────────────────────────

  const handleApplySuggestion = useCallback((suggested: string) => {
    setText(suggested)
    setIsSuggestion(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // ── Render ───────────────────────────────────────────

  if (!connectionActive) {
    return (
      <div className="text-center text-sm text-amber-600 py-2">
        Conexão Instagram inativa. Vá em Configurações para reconectar.
      </div>
    )
  }

  return (
    <div>
      {/* AI Suggestion panel */}
      {isSuggestionOpen && (
        <InstagramSuggestionPanel
          conversationId={conversationId}
          onApply={handleApplySuggestion}
          onClose={() => setIsSuggestion(false)}
        />
      )}

      {/* Media preview */}
      {mediaPreview && (
        <div className="flex items-center gap-3 mb-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
          {mediaPreview.file.type.startsWith('image/') && (
            <img src={mediaPreview.url} alt="preview" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          )}
          {mediaPreview.file.type.startsWith('video/') && (
            <video src={mediaPreview.url} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" muted />
          )}
          {mediaPreview.file.type.startsWith('audio/') && (
            <div className="w-12 h-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate">{mediaPreview.file.name}</p>
            <p className="text-[10px] text-slate-400">{(mediaPreview.file.size / 1024 / 1024).toFixed(1)} MB</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSendMedia}
              disabled={isSending}
              className="px-3 py-1.5 bg-pink-500 text-white text-xs rounded-lg hover:bg-pink-600 disabled:opacity-50 transition-colors font-medium"
            >
              {isUploading ? 'Enviando…' : 'Enviar'}
            </button>
            <button onClick={cancelMediaPreview} className="text-slate-400 hover:text-slate-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Upload / recording error */}
      {uploadError && (
        <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="flex-1">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Reply bar */}
      {replyingTo && (
        <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-pink-50 border border-pink-200 rounded-lg">
          <svg className="w-3.5 h-3.5 text-pink-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-pink-600 font-medium mb-0.5">
              {replyingTo.direction === 'inbound' ? 'Respondendo mensagem recebida' : 'Respondendo sua mensagem'}
            </p>
            <p className="text-xs text-slate-600 truncate">{replyingTo.content ?? '[mídia]'}</p>
          </div>
          <button onClick={() => onSetReplyingTo(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main input row */}
      <div className="flex items-end gap-2">
        {/* Left action buttons */}
        <div className="flex items-end gap-1">
          {/* Emoji picker */}
          <div className="relative" ref={emojiPickerRef}>
            <button
              onClick={() => { setIsEmojiOpen(p => !p); setIsSuggestion(false) }}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-pink-500 transition-colors text-lg"
              title="Emojis"
            >
              😊
            </button>
            {isEmojiOpen && (
              <div className="absolute bottom-11 left-0 z-50 shadow-2xl rounded-xl overflow-hidden">
                <Picker
                  data={data}
                  onEmojiSelect={handleSelectEmoji}
                  locale="pt"
                  theme="light"
                  previewPosition="none"
                  skinTonePosition="none"
                  maxFrequentRows={1}
                />
              </div>
            )}
          </div>

          {/* File upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept={[...ACCEPTED_IMAGES, ...ACCEPTED_VIDEOS, ...ACCEPTED_AUDIO].join(',')}
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending || isRecording}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-pink-500 disabled:opacity-40 transition-colors"
            title="Enviar imagem, vídeo ou áudio"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* AI suggestion */}
          <button
            onClick={() => { setIsSuggestion(p => !p); setIsEmojiOpen(false) }}
            disabled={isSending || isRecording}
            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${
              isSuggestionOpen
                ? 'bg-pink-100 text-pink-600'
                : 'text-slate-500 hover:bg-slate-100 hover:text-pink-500'
            }`}
            title="Sugestão de resposta por IA"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </button>
        </div>

        {/* Textarea */}
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? '🎙 Gravando áudio…' : 'Mensagem…'}
          rows={1}
          disabled={sendLoading || isRecording}
          className="flex-1 resize-none px-4 py-2.5 bg-slate-100 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:bg-white transition-all max-h-32 overflow-y-auto disabled:opacity-50"
          style={{ minHeight: '42px' }}
        />

        {/* Right: audio + send */}
        <div className="flex items-end gap-1">
          {/* Audio record */}
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={isSending || !!mediaPreview}
            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all disabled:opacity-40 ${
              isRecording
                ? 'bg-red-500 text-white animate-pulse'
                : 'text-slate-500 hover:bg-slate-100 hover:text-pink-500'
            }`}
            title={isRecording ? 'Soltar para enviar' : 'Segurar para gravar áudio'}
          >
            <svg className="w-5 h-5" fill={isRecording ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={!text.trim() || isSending || isRecording}
            className="w-10 h-10 bg-gradient-to-br from-pink-500 to-pink-600 text-white rounded-xl flex items-center justify-center hover:from-pink-600 hover:to-pink-700 disabled:opacity-40 transition-all shadow-sm"
            title="Enviar"
          >
            {sendLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default InstagramMessageInput
