// =====================================================
// POST /api/agents/documents/process
//
// Pipeline de processamento de documento RAG.
// Acesso restrito: empresa pai + admin/super_admin.
//
// Fluxo (Opção B — zero downtime de conhecimento):
//   1.  Autenticação e permissão
//   2.  Busca e validação do documento
//   3.  CAS lock atômico (status != processing → 409 se falhar)
//   4.  Download do arquivo do Storage (service_role)
//   5.  Extração de texto
//   6.  Geração de chunks
//   7.  Geração de embeddings (text-embedding-3-small)
//   8.  INSERT chunks com doc_version = pending_version
//       (chunks antigos continuam ativos durante este passo)
//   9.  Promoção atômica: version = pending_version, status = ready
//   10. DELETE chunks da versão anterior (cleanup não crítico)
//
// Em qualquer falha entre 4 e 9:
//   - DELETE chunks com doc_version = pending_version (rollback)
//   - status = error, pending_version = null, error_message = causa
//   - Chunks anteriores permanecem ativos — zero downtime
// =====================================================

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import { downloadDocumentFile } from '../../lib/agents/storage.js'
import { extractText, splitIntoChunks } from '../../lib/agents/chunker.js'
import { getOpenAIClient } from '../../lib/openai/client.js'

// ── Cliente service_role ──────────────────────────────────────────────────────
// Necessário para INSERT/DELETE em lovoo_agent_chunks (sem políticas RLS para authenticated).

function getServiceClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonError(res: any, status: number, message: string): void {
  res.setHeader('Content-Type', 'application/json')
  res.status(status).json({ ok: false, error: message })
}

function now(): string {
  return new Date().toISOString()
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    return jsonError(res, 405, 'Método não permitido')
  }

  // ── 1. Autenticação ───────────────────────────────────────────────────────

  const auth = await assertCanManageOpenAIIntegration(req)
  if (!auth.ok) {
    return jsonError(res, auth.status, auth.message)
  }

  // ── 2. Validar body ───────────────────────────────────────────────────────

  const body = req.body as Record<string, unknown>
  const documentId = typeof body?.document_id === 'string' ? body.document_id.trim() : ''

  if (!documentId) {
    return jsonError(res, 400, 'Campo obrigatório ausente: document_id')
  }

  // ── 3. Buscar documento ───────────────────────────────────────────────────
  // Usa JWT do usuário — RLS garante acesso apenas a documentos da empresa pai.

  const { data: doc, error: fetchErr } = await auth.supabase
    .from('lovoo_agent_documents')
    .select('id, agent_id, name, storage_path, file_type, status, version, pending_version, content_hash')
    .eq('id', documentId)
    .maybeSingle()

  if (fetchErr || !doc) {
    return jsonError(res, 404, 'Documento não encontrado ou sem permissão de acesso')
  }

  // ── 4. Verificação rápida de status antes do CAS ──────────────────────────

  if (doc.status === 'processing') {
    return jsonError(res, 409, 'Processamento já em andamento para este documento')
  }

  // ── 5. CAS lock atômico ───────────────────────────────────────────────────
  //
  // UPDATE WHERE status != 'processing' garante que somente um processo
  // pode adquirir o lock. Se 0 linhas retornadas → concorrência → 409.

  const nextVersion = (doc.version as number) + 1

  const { data: locked, error: lockErr } = await auth.supabase
    .from('lovoo_agent_documents')
    .update({
      status:               'processing',
      pending_version:      nextVersion,
      processing_started_at: now(),
      error_message:        null,
    })
    .eq('id', documentId)
    .neq('status', 'processing')
    .select('id, agent_id, version, storage_path, file_type')
    .single()

  if (lockErr || !locked) {
    return jsonError(res, 409, 'Não foi possível iniciar processamento — tente novamente')
  }

  const agentId = locked.agent_id as string
  const storagePath = locked.storage_path as string
  const fileType = locked.file_type as string

  // ── 6. Pipeline principal — envolto em try/catch para rollback ────────────

  const svc = getServiceClient()
  if (!svc) {
    await rollback(auth.supabase, svc, documentId, nextVersion, 'Supabase service_role não configurado')
    return jsonError(res, 500, 'Configuração de servidor incompleta')
  }

  try {
    // ── 6a. Download do arquivo ───────────────────────────────────────────

    const download = await downloadDocumentFile(storagePath)
    if (!download.ok) {
      throw new Error(`Falha ao baixar arquivo: ${download.error}`)
    }

    // ── 6b. Extração de texto ─────────────────────────────────────────────

    const rawText = extractText(download.buffer)
    if (!rawText.trim()) {
      throw new Error('O arquivo não contém texto legível')
    }

    // ── 6c. Chunking ──────────────────────────────────────────────────────

    const chunks = splitIntoChunks(rawText)
    if (chunks.length === 0) {
      throw new Error('Nenhum chunk gerado — verifique o conteúdo do arquivo')
    }

    // ── 6d. Geração de embeddings ─────────────────────────────────────────

    const openai = getOpenAIClient()
    if (!openai) {
      throw new Error('OpenAI não configurado — verifique OPENAI_API_KEY')
    }

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: chunks.map((c) => c.content),
    })

    if (embeddingResponse.data.length !== chunks.length) {
      throw new Error(
        `Inconsistência de embeddings: esperado ${chunks.length}, recebido ${embeddingResponse.data.length}`
      )
    }

    // ── 6e. Montar linhas de chunks ───────────────────────────────────────

    const chunkRows = chunks.map((chunk, i) => ({
      agent_id:    agentId,
      document_id: documentId,
      doc_version: nextVersion,
      chunk_index: chunk.chunk_index,
      content:     chunk.content,
      embedding:   embeddingResponse.data[i].embedding,
      metadata:    chunk.metadata,
    }))

    // ── 6f. INSERT novos chunks (service_role, bypass RLS) ────────────────
    //
    // Chunks antigos (doc_version < nextVersion) continuam ativos no retriever
    // durante este passo — zero downtime de conhecimento.

    const { error: insertErr } = await svc
      .from('lovoo_agent_chunks')
      .insert(chunkRows)

    if (insertErr) {
      throw new Error(`Erro ao persistir chunks: ${insertErr.message}`)
    }

    // ── 6g. Promoção atômica da versão ────────────────────────────────────
    //
    // Após este UPDATE, o retriever passa a usar os novos chunks.
    // O filtro "c.doc_version = d.version" na RPC garantirá isso.

    const { error: promoteErr } = await auth.supabase
      .from('lovoo_agent_documents')
      .update({
        version:          nextVersion,
        pending_version:  null,
        status:           'ready',
        chunk_count:      chunks.length,
        last_processed_at: now(),
        error_message:    null,
      })
      .eq('id', documentId)

    if (promoteErr) {
      throw new Error(`Falha na promoção de versão: ${promoteErr.message}`)
    }

    // ── 6h. Cleanup: deletar chunks da versão anterior ────────────────────
    //
    // Não crítico — falha aqui não afeta consistência nem o retriever.
    // Chunks antigos têm doc_version < nextVersion e serão ignorados pela RPC.

    const prevVersion = doc.version as number
    if (prevVersion < nextVersion) {
      await svc
        .from('lovoo_agent_chunks')
        .delete()
        .eq('document_id', documentId)
        .lt('doc_version', nextVersion)
    }

    // ── 7. Resposta de sucesso ────────────────────────────────────────────

    res.status(200).json({
      ok:          true,
      document_id: documentId,
      status:      'ready',
      version:     nextVersion,
      chunk_count: chunks.length,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido no processamento'

    // ── Rollback ──────────────────────────────────────────────────────────
    //
    // 1. Deletar chunks novos que foram inseridos (doc_version = nextVersion)
    // 2. Reverter status do documento para 'error'
    // 3. Limpar pending_version
    // Chunks antigos permanecem intactos — retriever continua funcionando.

    await rollback(auth.supabase, svc, documentId, nextVersion, message)

    return jsonError(res, 500, `Processamento falhou: ${message}`)
  }
}

// ── Rollback ──────────────────────────────────────────────────────────────────

async function rollback(
  userSupabase: any,
  svc: SupabaseClient | null,
  documentId: string,
  pendingVersion: number,
  errorMessage: string
): Promise<void> {
  // 1. Remover chunks da versão que falhou (se algum foi inserido)
  if (svc) {
    await svc
      .from('lovoo_agent_chunks')
      .delete()
      .eq('document_id', documentId)
      .eq('doc_version', pendingVersion)
  }

  // 2. Marcar documento como 'error', liberar lock de pending_version
  await userSupabase
    .from('lovoo_agent_documents')
    .update({
      status:               'error',
      pending_version:      null,
      processing_started_at: null,
      error_message:        errorMessage.slice(0, 500),
    })
    .eq('id', documentId)
}
