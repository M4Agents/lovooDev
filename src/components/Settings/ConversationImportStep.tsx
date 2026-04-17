/**
 * ConversationImportStep
 *
 * Etapa opcional (Step 0) no wizard de criação de agente.
 * Permite ao usuário enviar exportações .txt do WhatsApp para análise.
 * O sistema retorna insights estruturados que pré-preenchem os campos do wizard.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  MessageSquare,
  SkipForward,
  Upload,
  X,
} from 'lucide-react'
import { promptBuilderApi, type ConversationAnalysis } from '../../services/promptBuilderApi'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Props {
  companyId: string
  onAnalyzed: (analysis: ConversationAnalysis) => void
  onSkip:     () => void
}

interface QualityInfo {
  score: number
  label: 'boa' | 'razoável' | 'insuficiente'
}

type Status = 'idle' | 'loading' | 'success' | 'error'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_FILES      = 10
const MAX_SIZE_MB    = 2
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

function formatFileSize(bytes: number) {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function qualityColor(label: string) {
  if (label === 'boa')          return 'text-green-600 bg-green-50 border-green-200'
  if (label === 'razoável')     return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-red-600 bg-red-50 border-red-200'
}

function qualityIcon(label: string) {
  if (label === 'boa')      return '✅'
  if (label === 'razoável') return '⚠️'
  return '❌'
}

// ── Sub-componentes utilitários ───────────────────────────────────────────────

function PatternList({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1.5">{label}</p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700">
            <span className="text-gray-400 shrink-0 mt-px">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Conta quantos campos significativos a análise contém.
 * Análise fraca = poucas listas com dados úteis.
 */
function countFilledPatterns(analysis: ConversationAnalysis): number {
  const dp = analysis.detected_patterns
  if (!dp) return 0
  return [
    dp.tone,
    ...(dp.frequent_customer_questions ?? []),
    ...(dp.objections ?? []),
    ...(dp.attendant_questions ?? []),
    ...(dp.closing_patterns ?? []),
  ].filter(Boolean).length
}

// ── Componente ────────────────────────────────────────────────────────────────

export function ConversationImportStep({ companyId, onAnalyzed, onSkip }: Props) {
  const [files,    setFiles]    = useState<File[]>([])
  const [status,   setStatus]   = useState<Status>('idle')
  const [error,    setError]    = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null)
  const [quality,  setQuality]  = useState<QualityInfo | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // ── Seleção de arquivos ──────────────────────────────────────────────────────

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setError(null)
    const arr = Array.from(newFiles)
    const validationErrors: string[] = []

    const valid = arr.filter(f => {
      if (!f.name.toLowerCase().endsWith('.txt')) {
        validationErrors.push(`"${f.name}" não é um arquivo .txt`)
        return false
      }
      if (f.size > MAX_SIZE_BYTES) {
        validationErrors.push(`"${f.name}" excede ${MAX_SIZE_MB} MB`)
        return false
      }
      return true
    })

    if (validationErrors.length) {
      setError(validationErrors.join('. '))
      return
    }

    setFiles(prev => {
      const combined = [...prev, ...valid]
      if (combined.length > MAX_FILES) {
        setError(`Máximo de ${MAX_FILES} arquivos permitido.`)
        return prev
      }
      return combined
    })
  }, [])

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
    setError(null)
  }

  // ── Drag and Drop ────────────────────────────────────────────────────────────

  const [dragging, setDragging] = useState(false)

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true)  }
  const handleDragLeave = ()                      => { setDragging(false) }
  const handleDrop      = (e: React.DragEvent)   => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  // ── Análise ──────────────────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!files.length) return
    setStatus('loading')
    setError(null)

    try {
      const result = await promptBuilderApi.analyzeConversations(companyId, files)
      setAnalysis(result.conversation_analysis)
      setQuality(result.quality)
      setStatus('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao analisar. Tente novamente.'
      setError(msg)
      setStatus('error')
    }
  }

  const handleUseAnalysis = () => {
    if (analysis) onAnalyzed(analysis)
  }

  const handleRetry = () => {
    setStatus('idle')
    setError(null)
    setAnalysis(null)
    setQuality(null)
    setFiles([])
  }

  // #region agent log — debug scroll
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (status !== 'success') return
    const el = rootRef.current
    if (!el) return
    // Mede o próprio componente e percorre DOM até encontrar o scroll container
    let scrollContainer: HTMLElement | null = el.parentElement
    while (scrollContainer && getComputedStyle(scrollContainer).overflowY !== 'auto' && getComputedStyle(scrollContainer).overflowY !== 'scroll') {
      scrollContainer = scrollContainer.parentElement
    }
    const sc = scrollContainer
    const payload = {
      sessionId: 'cf8832', runId: 'run1',
      hypothesisId: 'B-D',
      location: 'ConversationImportStep.tsx:rootRef',
      message: 'component height after analysis shown',
      timestamp: Date.now(),
      data: {
        componentScrollHeight: el.scrollHeight,
        componentOffsetHeight: el.offsetHeight,
        scrollContainerFound: !!sc,
        scrollContainerTag: sc?.tagName ?? 'none',
        scrollContainerScrollHeight: sc?.scrollHeight ?? 'n/a',
        scrollContainerClientHeight: sc?.clientHeight ?? 'n/a',
        scrollContainerOverflowY: sc ? getComputedStyle(sc).overflowY : 'n/a',
        wouldOverflow: sc ? (sc.scrollHeight > sc.clientHeight) : 'n/a',
      },
    }
    console.log('[DBG:cf8832][post-fix] ConversationImportStep after analysis', payload.data)
  }, [status])
  // #endregion

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-500 shrink-0" />
          <h4 className="text-sm font-semibold text-gray-800">
            Importar conversas reais do WhatsApp
          </h4>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-medium shrink-0">
            opcional
          </span>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed">
          Envie conversas exportadas do WhatsApp para que o sistema entenda como
          sua empresa atende na prática.
        </p>

        {/* O que identificamos */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 space-y-2">
          <p className="text-xs font-medium text-gray-600">Com base nessas conversas, identificamos:</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {[
              'Tom de comunicação',
              'Perguntas frequentes',
              'Objeções dos clientes',
              'Padrões de condução de vendas',
            ].map(item => (
              <li key={item} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 pt-0.5 border-t border-gray-200">
            Essas informações pré-preenchem automaticamente os campos do seu agente de IA.
          </p>
        </div>

        {/* Dicas */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500">💡 Para melhores resultados:</p>
          <ul className="space-y-0.5">
            {[
              'Conversas reais com início, meio e possível fechamento',
              'Inclua trocas com dúvidas, objeções e negociações',
              'Recomendado: pelo menos 10+ trocas relevantes',
              `Até ${MAX_FILES} arquivos .txt por vez (exportados do WhatsApp)`,
            ].map(tip => (
              <li key={tip} className="flex items-start gap-1.5 text-xs text-gray-500">
                <span className="text-gray-300 shrink-0 mt-px">–</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Dropzone */}
      {status !== 'success' && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`
            relative border-2 border-dashed rounded-xl p-6 cursor-pointer
            flex flex-col items-center gap-3 text-center transition-colors
            ${dragging
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
            }
          `}
        >
          <Upload className="w-7 h-7 text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-700">
              Clique ou arraste arquivos aqui
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Apenas arquivos .txt exportados do WhatsApp · Máx. {MAX_FILES} arquivos · {MAX_SIZE_MB} MB cada
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".txt,text/plain"
            className="hidden"
            onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
        </div>
      )}

      {/* Lista de arquivos */}
      {files.length > 0 && status !== 'success' && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
              <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-gray-400 shrink-0">{formatFileSize(f.size)}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Erro */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Resultado da análise */}
      {status === 'success' && analysis && quality && (() => {
        const filledCount = countFilledPatterns(analysis)
        const isWeak      = filledCount < 3

        return (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* Badge de qualidade */}
            <div className={`flex items-center gap-2 text-xs font-medium border rounded-lg px-3 py-2 ${qualityColor(quality.label)}`}>
              <span>{qualityIcon(quality.label)}</span>
              <span>
                Qualidade da amostra: <strong>{quality.label}</strong>
                {' '}({quality.score}/100)
              </span>
            </div>

            {/* Aviso de análise fraca — exibido em destaque quando poucos dados */}
            {isWeak && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Poucos padrões foram identificados nesta conversa. Você pode continuar, mas revise
                  os campos no próximo passo antes de gerar o agente.
                </span>
              </div>
            )}

            {/* Resumo */}
            {analysis.analysis_summary && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                <p className="text-xs font-medium text-blue-700 mb-1">Resumo do atendimento</p>
                <p className="text-xs text-blue-600 leading-relaxed">{analysis.analysis_summary}</p>
              </div>
            )}

            {/* Tom */}
            {analysis.detected_patterns?.tone && (
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <span className="font-medium text-gray-500">Tom identificado:</span>
                <span className="bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full font-medium">
                  {analysis.detected_patterns.tone}
                </span>
              </div>
            )}

            {/* Perguntas frequentes */}
            <PatternList
              label="Perguntas frequentes dos clientes"
              items={analysis.detected_patterns?.frequent_customer_questions}
            />

            {/* Objeções */}
            <PatternList
              label="Objeções recorrentes"
              items={analysis.detected_patterns?.objections}
            />

            {/* Perguntas do atendente */}
            <PatternList
              label="Perguntas usadas para qualificar"
              items={analysis.detected_patterns?.attendant_questions}
            />

            {/* Config sugerida — prévia (oculta quando análise fraca sem config) */}
            {analysis.suggested_prompt_config && (
              <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2.5 space-y-1">
                <p className="text-xs font-medium text-green-700">
                  Configuração sugerida para o agente
                </p>
                {analysis.suggested_prompt_config.objective && (
                  <p className="text-xs text-green-700">
                    <span className="font-medium">Objetivo: </span>
                    {analysis.suggested_prompt_config.objective}
                  </p>
                )}
                {analysis.suggested_prompt_config.communication_style && (
                  <p className="text-xs text-green-700">
                    <span className="font-medium">Estilo: </span>
                    {analysis.suggested_prompt_config.communication_style}
                  </p>
                )}
              </div>
            )}

            {/* Aviso de qualidade insuficiente (análise OK mas amostra pequena) */}
            {!isWeak && quality.label === 'insuficiente' && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  A amostra é pequena. Os campos serão pré-preenchidos, mas revise antes de continuar.
                </span>
              </div>
            )}
          </div>
        )
      })()}

      {/* Botões */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Pular esta etapa
        </button>

        <div className="flex items-center gap-2">
          {status === 'success' ? (
            <>
              <button
                onClick={handleRetry}
                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 transition-colors"
              >
                Usar outros arquivos
              </button>
              <button
                onClick={handleUseAnalysis}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                           text-sm rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Usar análise e continuar
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={handleAnalyze}
              disabled={files.length === 0 || status === 'loading'}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                         text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40
                         transition-colors font-semibold shadow-sm"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analisando...
                </>
              ) : (
                <>
                  <MessageSquare className="w-3.5 h-3.5" />
                  Analisar conversas
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Nota de privacidade */}
      <div className="flex items-start gap-1.5 border-t border-gray-100 pt-3">
        <span className="text-xs shrink-0">🔒</span>
        <p className="text-xs text-gray-400 leading-relaxed">
          <span className="font-medium text-gray-500">Privacidade:</span>{' '}
          Seus dados são anonimizados automaticamente e não são armazenados.
        </p>
      </div>
    </div>
  )
}
