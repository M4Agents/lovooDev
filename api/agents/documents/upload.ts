// =====================================================
// POST /api/agents/documents/upload
//
// Upload de documento RAG para um Agente Lovoo global.
// Acesso restrito: empresa pai + admin/super_admin.
//
// Fluxo:
//   1. Autenticação e permissão (empresa pai)
//   2. Parse multipart (formidable)
//   3. Validação de tipo e tamanho
//   4. SHA-256 calculado server-side
//   5. Detecção de duplicidade por content_hash
//   6. Upload ao Supabase Storage (service_role, bucket privado)
//   7. Inserção em lovoo_agent_documents (status = pending)
//   8. Resposta com documento criado ou duplicata detectada
//
// NÃO inicia processamento. O processamento é disparado
// por endpoint separado (/api/agents/documents/process).
// =====================================================

import { createHash, randomUUID } from 'crypto'
import { readFile, unlink } from 'fs/promises'
import { formidable } from 'formidable'
import type { IncomingMessage, ServerResponse } from 'http'
import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import { uploadDocumentFile, deleteDocumentFile } from '../../lib/agents/storage.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024 // 1 MB
const ALLOWED_MIME_TYPES = new Set(['text/plain', 'text/markdown'])

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Remove caracteres problemáticos do nome do arquivo.
 * Mantém: letras, números, hífens, underscores, pontos.
 */
function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200) || 'document'
}

async function cleanupTempFile(filepath: string): Promise<void> {
  try {
    await unlink(filepath)
  } catch {
    // silencioso — arquivo temp pode já ter sido removido
  }
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: message }))
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'POST') {
    return jsonError(res, 405, 'Método não permitido')
  }

  // ── 1. Autenticação e permissão ───────────────────────────────────────────

  const auth = await assertCanManageOpenAIIntegration(req as Parameters<typeof assertCanManageOpenAIIntegration>[0])
  if (!auth.ok) {
    return jsonError(res, auth.status, auth.message)
  }

  // ── 2. Parse multipart ────────────────────────────────────────────────────

  const form = formidable({
    maxFileSize: MAX_FILE_SIZE_BYTES,
    maxFiles: 1,
    keepExtensions: true,
    // Não persistir em disco além do necessário
    maxTotalFileSize: MAX_FILE_SIZE_BYTES,
  })

  let fields: Awaited<ReturnType<typeof form.parse>>[0]
  let files: Awaited<ReturnType<typeof form.parse>>[1]

  try {
    ;[fields, files] = await form.parse(req)
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message.toLowerCase().includes('maxfilesize')
        ? `Arquivo excede o limite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`
        : 'Erro ao processar upload'
    return jsonError(res, 400, message)
  }

  // ── 3. Extrair e validar campos do form ───────────────────────────────────

  const agentId = Array.isArray(fields.agent_id) ? fields.agent_id[0] : undefined
  const docName = Array.isArray(fields.name) ? fields.name[0] : undefined

  if (!agentId?.trim()) {
    return jsonError(res, 400, 'Campo obrigatório ausente: agent_id')
  }

  const fileArr = files.file
  const uploadedFile = Array.isArray(fileArr) ? fileArr[0] : undefined

  if (!uploadedFile) {
    return jsonError(res, 400, 'Arquivo não enviado. Use o campo "file" no FormData.')
  }

  // ── 4. Validar tipo MIME ──────────────────────────────────────────────────

  const mimeType = uploadedFile.mimetype ?? ''
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    await cleanupTempFile(uploadedFile.filepath)
    return jsonError(res, 415, 'Tipo de arquivo não suportado. Aceito: text/plain, text/markdown')
  }

  // ── 5. Validar tamanho ────────────────────────────────────────────────────

  if (uploadedFile.size === 0) {
    await cleanupTempFile(uploadedFile.filepath)
    return jsonError(res, 400, 'Arquivo vazio não é permitido')
  }

  // ── 6. Ler buffer e calcular SHA-256 server-side ──────────────────────────

  let fileBuffer: Buffer
  try {
    fileBuffer = await readFile(uploadedFile.filepath)
  } catch {
    return jsonError(res, 500, 'Erro ao ler arquivo enviado')
  } finally {
    await cleanupTempFile(uploadedFile.filepath)
  }

  const contentHash = createHash('sha256').update(fileBuffer).digest('hex')

  // ── 7. Validar existência do agente (via JWT + RLS) ───────────────────────
  //
  // auth.supabase usa o JWT do usuário. O RLS de lovoo_agents garante que
  // somente agentes da empresa pai são acessíveis para este usuário.

  const { data: agent, error: agentErr } = await auth.supabase
    .from('lovoo_agents')
    .select('id')
    .eq('id', agentId.trim())
    .maybeSingle()

  if (agentErr || !agent) {
    return jsonError(res, 404, 'Agente não encontrado ou sem permissão de acesso')
  }

  // ── 8. Detectar duplicidade por content_hash ──────────────────────────────
  //
  // Regra MVP: se já existe documento com mesmo agent_id + content_hash,
  // não criar duplicata. Retornar informação do existente.

  const { data: existingDoc } = await auth.supabase
    .from('lovoo_agent_documents')
    .select('id, name, status, version, chunk_count')
    .eq('agent_id', agentId.trim())
    .eq('content_hash', contentHash)
    .maybeSingle()

  if (existingDoc) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        duplicate: true,
        message: 'Documento com conteúdo idêntico já existe para este agente.',
        document: existingDoc,
      })
    )
    return
  }

  // ── 9. Montar path e fazer upload no Storage ──────────────────────────────
  //
  // Path: {agent_id}/{document_id}/{filename_sanitized}
  // Bucket privado — nenhuma URL pública é gerada.
  // Upload via service_role em api/lib/agents/storage.ts.

  const documentId = randomUUID()
  const originalName = uploadedFile.originalFilename ?? 'document.txt'
  const safeName = sanitizeFilename(originalName)
  const storagePath = `${agentId.trim()}/${documentId}/${safeName}`
  const finalName = docName?.trim() || originalName

  const storageResult = await uploadDocumentFile(storagePath, fileBuffer, mimeType)
  if (!storageResult.ok) {
    return jsonError(res, 500, `Falha no storage: ${storageResult.error}`)
  }

  // ── 10. Inserir em lovoo_agent_documents ──────────────────────────────────

  const { data: doc, error: insertErr } = await auth.supabase
    .from('lovoo_agent_documents')
    .insert({
      id:           documentId,
      agent_id:     agentId.trim(),
      name:         finalName,
      storage_path: storagePath,
      file_type:    mimeType,
      file_size:    fileBuffer.length,
      status:       'pending',
      content_hash: contentHash,
      chunk_count:  0,
      version:      1,
    })
    .select()
    .single()

  if (insertErr || !doc) {
    // Rollback: remover arquivo orphão do Storage
    await deleteDocumentFile(storagePath)
    return jsonError(res, 500, 'Erro ao registrar documento. Upload revertido.')
  }

  // ── 11. Resposta ──────────────────────────────────────────────────────────

  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      ok:        true,
      duplicate: false,
      document:  doc,
    })
  )
}
