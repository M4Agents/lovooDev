// =====================================================
// Storage helper — documentos RAG dos Agentes Lovoo
//
// Todas as operações usam service_role para acessar
// o bucket privado "lovoo-agent-docs".
//
// Nunca chamar diretamente do frontend.
// Nunca expor URLs de download para o cliente.
// =====================================================

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'lovoo-agent-docs'

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Faz upload de um arquivo para o bucket privado.
 * Usa service_role — nunca expõe URL pública.
 */
export async function uploadDocumentFile(
  storagePath: string,
  buffer: Buffer,
  contentType: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const svc = getServiceSupabase()
  if (!svc) return { ok: false, error: 'Supabase service_role não configurado' }

  const { error } = await svc.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Remove um arquivo do bucket privado.
 * Chamado em rollback (falha de processamento ou deleção de documento).
 */
export async function deleteDocumentFile(storagePath: string): Promise<void> {
  const svc = getServiceSupabase()
  if (!svc) return
  await svc.storage.from(BUCKET).remove([storagePath])
}

/**
 * Faz download do conteúdo de um arquivo como Buffer.
 * Chamado pelo pipeline de processamento (server-side exclusivo).
 */
export async function downloadDocumentFile(
  storagePath: string
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const svc = getServiceSupabase()
  if (!svc) return { ok: false, error: 'Supabase service_role não configurado' }

  const { data, error } = await svc.storage.from(BUCKET).download(storagePath)

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Arquivo não encontrado' }
  }

  const arrayBuffer = await data.arrayBuffer()
  return { ok: true, buffer: Buffer.from(arrayBuffer) }
}
