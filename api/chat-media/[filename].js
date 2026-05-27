// =====================================================
// GET /api/chat-media/[filename]
//
// Proxy autenticado para arquivos do bucket privado chat-media.
// Valida Bearer token, verifica membership do usuário na empresa
// dona da mensagem (Trilha 1), gera signed URL temporária e redireciona.
//
// Segurança:
//   - service_role apenas para queries admin e storage
//   - Nunca expor signed URL sem validar membership
//   - Bucket permanece privado
// =====================================================

import { createClient }    from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const { filename } = req.query
  if (!filename) {
    return res.status(400).json({ error: 'Filename é obrigatório' })
  }

  // ── 1. Extrair e validar Bearer token ──────────────────────────────────────
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' })
  }
  const token = authHeader.slice(7).trim()
  if (!token) {
    return res.status(401).json({ error: 'Token inválido' })
  }

  const supabaseUrl  = process.env.VITE_SUPABASE_URL       ?? ''
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY  ?? ''
  if (!supabaseUrl || !supabaseAnon) {
    return res.status(500).json({ error: 'Configuração de servidor incompleta' })
  }

  const caller = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: authError } = await caller.auth.getUser()
  if (authError || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  const svc = getSupabaseAdmin()

  // ── 2. Localizar mensagem e obter company_id ────────────────────────────────
  const mediaUrlKey = `/api/chat-media/${filename}`

  const { data: message, error: msgError } = await svc
    .from('chat_messages')
    .select('company_id')
    .eq('media_url', mediaUrlKey)
    .maybeSingle()

  if (msgError || !message) {
    return res.status(403).json({ error: 'Arquivo não encontrado ou sem permissão' })
  }

  // ── 3. Validar membership ativo (Trilha 1) ──────────────────────────────────
  const { data: member } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', message.company_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) {
    return res.status(403).json({ error: 'Acesso negado' })
  }

  // ── 4. Gerar signed URL via service_role (válida por 1 hora) ───────────────
  const { data: signedUrlData, error: signedUrlError } = await svc.storage
    .from('chat-media')
    .createSignedUrl(filename, 3600)

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error('[chat-media] Falha ao gerar signed URL:', signedUrlError?.message)
    return res.status(500).json({ error: 'Falha ao gerar URL de acesso' })
  }

  // ── 5. Redirecionar para a signed URL ──────────────────────────────────────
  return res.redirect(302, signedUrlData.signedUrl)
}
