// =============================================================================
// GET /api/whatsapp/meta/instances
//
// Lista as instâncias Meta WhatsApp ativas da empresa solicitada.
//
// Fluxo (ordem obrigatória — não alterar):
//   1. Method guard (GET only)
//   2. company_id extraído de req.query
//   3. getSupabaseAdmin()
//   4. validateMetaCaller() — auth + RBAC + feature flag
//   5. [somente após guard.ok] SELECT instâncias ativas
//   6. Resposta sanitizada
//
// Segurança:
//   - company_id da query é somente o tenant solicitado — não autoriza acesso
//   - A query usa EXCLUSIVAMENTE guard.companyId (validado pelo guard)
//   - validateMetaCaller valida: Bearer → JWT → UUID → membership → role →
//       partner assignment → parent/child → feature flag
//   - Seller e acima têm permissão via META_VIEW_ROLES
//   - Partner exige assignment ativo (validado internamente pelo guard)
//   - Parent → child: somente super_admin/system_admin do parent correto
//   - service_role usado SOMENTE após autorização bem-sucedida
//   - meta_whatsapp_credentials nunca consultada
//   - Resposta nunca contém: connected_by, company_id, deleted_at,
//       access_token_enc, credenciais ou qualquer secret
//   - Erros internos nunca refletem detalhes de infra ao caller
//   - Zero logging de Authorization, token ou stack
//
// Lista vazia é estado válido:
//   Empresa habilitada sem instâncias conectadas → 200 { instances: [] }
// =============================================================================

import { getSupabaseAdmin }                         from '../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES }       from '../../lib/meta-whatsapp/validateMetaCaller.js';

// Campos públicos retornados ao frontend.
// Nunca incluir: connected_by, company_id, deleted_at, access_token_enc.
const PUBLIC_FIELDS = [
  'id',
  'phone_number_id',
  'waba_id',
  'display_name',
  'phone_number',
  'verified_name',
  'status',
  'created_at',
  'updated_at',
].join(', ');

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. company_id da query string ──────────────────────────────────────────
  // Somente identifica o tenant solicitado — não autoriza acesso.
  // A autorização real ocorre no validateMetaCaller abaixo.
  const companyId = req.query?.company_id;
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  // ── 3. Supabase admin client ───────────────────────────────────────────────
  // Instanciação em memória apenas — sem query ao banco aqui.
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Proteção defensiva externa — captura throws inesperados de:
  //   validateMetaCaller, svc.from(...).select(...), e qualquer outro await.
  // Nunca logar: Authorization, token, stack.
  try {

  // ── 4. Auth + RBAC + feature flag ─────────────────────────────────────────
  // validateMetaCaller valida (nesta ordem):
  //   Bearer → JWT → UUID format → membership → role → partner → parent → flag
  // META_VIEW_ROLES inclui seller — pode listar instâncias configuradas.
  // META_CONNECT_ROLES NÃO é usado aqui (ação de leitura, não de escrita).
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_VIEW_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 5. SELECT instâncias ativas ───────────────────────────────────────────
  // Usa guard.companyId — nunca req.query.company_id diretamente.
  // Garante que a query é exatamente para a empresa que o guard autorizou.
  //
  // Filtros obrigatórios:
  //   company_id = guard.companyId  → isolamento de tenant
  //   deleted_at IS NULL            → somente instâncias ativas
  //
  // SELECT explícito: nunca SELECT *.
  // meta_whatsapp_credentials: nunca consultada neste endpoint.
  const { data: instances, error: queryErr } = await svc
    .from('meta_whatsapp_instances')
    .select(PUBLIC_FIELDS)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (queryErr) {
    // Erro operacional (conexão, permissão, etc.) — não expor detalhes.
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 6. Resposta sanitizada ─────────────────────────────────────────────────
  // Lista vazia é estado válido — empresa habilitada sem instâncias ainda.
  // Nunca usar 404 para lista vazia.
  return res.status(200).json({ instances: instances ?? [] });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    // Nunca retornar err.message, err.code, stack ou qualquer detalhe de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
