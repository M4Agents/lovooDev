// =====================================================
// useContactCycleQuestions
//
// Gerencia a lista de perguntas dinâmicas de tentativa de contato.
//
// Expõe:
//   questions — lista atual (ativa ou completa, conforme canManage)
//   loading   — carregamento inicial em andamento
//   saving    — operação de escrita em andamento
//   error     — mensagem do último erro; null se nenhum
//   refresh() — força recarregamento
//   create()  — cria pergunta com validação client-side; retorna item criado ou null
//   update()  — edita campos ou altera active; retorna true se salvo
//
// Regras:
//   • canManage=true  → inclui inativas (admin+)
//   • canManage=false → apenas ativas (seller)
//   • label: obrigatório, não vazio, ≤ 150 chars
//   • field_type: deve ser um dos 5 valores válidos
//   • options: obrigatório (≥ 1 item) quando field_type = 'select'
//   • options: enviado como null quando field_type ≠ 'select'
//   • sort_order: inteiro ≥ 0
//   • Nenhum DELETE físico — desativar via update({ active: false })
// =====================================================

import { useState, useCallback, useEffect } from 'react'
import { contactCycleApi } from '../services/contactCycleApi'
import type {
  ContactAttemptQuestion,
  ContactAttemptQuestionForm,
  ContactAttemptQuestionPatch,
  FieldType,
} from '../types/contact-cycles'

const VALID_FIELD_TYPES: FieldType[] = ['text', 'textarea', 'select', 'boolean', 'number']
const MAX_LABEL_LENGTH = 150

export interface UseContactCycleQuestionsReturn {
  questions: ContactAttemptQuestion[]
  loading:   boolean
  saving:    boolean
  error:     string | null
  refresh:   () => Promise<void>
  create:    (form: ContactAttemptQuestionForm) => Promise<ContactAttemptQuestion | null>
  update:    (questionId: string, patch: ContactAttemptQuestionPatch) => Promise<boolean>
}

export function useContactCycleQuestions(
  companyId: string | null,
  canManage: boolean,
): UseContactCycleQuestionsReturn {
  const [questions, setQuestions] = useState<ContactAttemptQuestion[]>([])
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      // Admin+ vê inativas para poder reativá-las; seller vê apenas ativas
      const data = await contactCycleApi.listQuestions(companyId, canManage)
      setQuestions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar perguntas de contato')
    } finally {
      setLoading(false)
    }
  }, [companyId, canManage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // ── Validação client-side ─────────────────────────────────────

  const validateForm = (
    form: ContactAttemptQuestionForm | ContactAttemptQuestionPatch,
  ): string | null => {
    if ('label' in form && form.label !== undefined) {
      const trimmed = form.label.trim()
      if (!trimmed) return 'O texto da pergunta é obrigatório'
      if (trimmed.length > MAX_LABEL_LENGTH) {
        return `O texto deve ter no máximo ${MAX_LABEL_LENGTH} caracteres`
      }
    }

    if ('field_type' in form && form.field_type !== undefined) {
      if (!VALID_FIELD_TYPES.includes(form.field_type)) {
        return `Tipo de campo inválido — valores aceitos: ${VALID_FIELD_TYPES.join(', ')}`
      }
    }

    // options obrigatório quando field_type = 'select'
    if ('field_type' in form && form.field_type === 'select') {
      const opts = (form as ContactAttemptQuestionForm).options
      if (!Array.isArray(opts) || opts.length === 0) {
        return 'Adicione ao menos uma opção para perguntas do tipo "select"'
      }
      const hasEmpty = opts.some(o => typeof o !== 'string' || !o.trim())
      if (hasEmpty) return 'Nenhuma opção pode estar em branco'
    }

    if ('sort_order' in form && form.sort_order !== undefined) {
      if (!Number.isInteger(form.sort_order) || form.sort_order < 0) {
        return 'A ordem deve ser um número inteiro maior ou igual a zero'
      }
    }

    return null
  }

  // ── Normalização: garantir options=null quando field_type ≠ 'select' ──

  function normalizeOptions<T extends { field_type?: FieldType; options?: string[] | null }>(
    form: T,
  ): T {
    if (form.field_type && form.field_type !== 'select') {
      return { ...form, options: null }
    }
    return form
  }

  // ── Ações ─────────────────────────────────────────────────────

  const create = useCallback(async (
    form: ContactAttemptQuestionForm,
  ): Promise<ContactAttemptQuestion | null> => {
    if (!companyId) return null

    const validationError = validateForm(form)
    if (validationError) {
      setError(validationError)
      return null
    }

    const normalized = normalizeOptions({
      ...form,
      label: form.label.trim(),
    })

    setSaving(true)
    setError(null)
    try {
      const created = await contactCycleApi.createQuestion(companyId, normalized)
      // Atualização otimista: insere respeitando sort_order (append ao final)
      setQuestions(prev => [...prev, created])
      return created
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar pergunta de contato')
      return null
    } finally {
      setSaving(false)
    }
  }, [companyId])

  const update = useCallback(async (
    questionId: string,
    patch: ContactAttemptQuestionPatch,
  ): Promise<boolean> => {
    if (!companyId) return false

    const validationError = validateForm(patch)
    if (validationError) {
      setError(validationError)
      return false
    }

    // Se field_type muda para algo diferente de 'select', zera options
    const normalizedPatch = normalizeOptions(patch)

    // Trim do label, se presente
    if (normalizedPatch.label !== undefined) {
      normalizedPatch.label = normalizedPatch.label.trim()
    }

    setSaving(true)
    setError(null)
    try {
      await contactCycleApi.updateQuestion(companyId, questionId, normalizedPatch)
      // Atualiza localmente sem novo fetch para UX mais ágil
      setQuestions(prev =>
        prev.map(q => q.id === questionId ? { ...q, ...normalizedPatch } : q),
      )
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar pergunta de contato')
      return false
    } finally {
      setSaving(false)
    }
  }, [companyId])

  return { questions, loading, saving, error, refresh, create, update }
}
