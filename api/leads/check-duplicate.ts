import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/leads/check-duplicate
 *
 * Verifica se já existe um lead com o mesmo telefone ou e-mail na empresa.
 * Usa service_role para ignorar RLS — garante que usuários com
 * restrict_leads_to_owner não criem duplicatas de leads de outros vendedores.
 *
 * Body: { company_id, phone?, email? }
 * Response: { isDuplicate, existingLead?: { id, name, phone, email, responsibleName, matchedBy } }
 */

const supabaseUrl      = process.env.SUPABASE_URL!;
const supabaseAnonKey  = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function extractToken(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function getUserFromToken(token: string) {
  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await caller.auth.getUser();
  return { user: user ?? null, error: error ?? null };
}

/**
 * Constrói os valores de lookup para phone_normalized.
 * Replica a lógica de api.ts:createLead e checkDuplicateLead do frontend.
 */
function buildPhoneLookupValues(phone: string): string[] {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) return [];

  const right11 = digits.slice(-11);
  const withoutNinth =
    digits.length === 13 && digits.startsWith('55') && digits.charAt(4) === '9'
      ? digits.slice(0, 4) + digits.slice(5)
      : null;

  return [...new Set([digits, right11, withoutNinth].filter(Boolean) as string[])];
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Autenticação JWT ──────────────────────────────────────────────────────
  const token = extractToken(req.headers['authorization']);
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação obrigatório' });
  }

  const { user, error: authError } = await getUserFromToken(token);
  if (!user || authError) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const { company_id, phone, email } = req.body ?? {};
  if (!company_id) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Validar membership (Trilha 1) ─────────────────────────────────────────
  const { data: member } = await svc
    .from('company_users')
    .select('role, is_active')
    .eq('user_id', user.id)
    .eq('company_id', company_id)
    .eq('is_active', true)
    .maybeSingle();

  // Trilha 2: super_admin / system_admin da empresa pai
  let effectiveMember = member;
  if (!member) {
    const { data: companyData } = await svc
      .from('companies')
      .select('parent_company_id')
      .eq('id', company_id)
      .maybeSingle();

    if (companyData?.parent_company_id) {
      const { data: parentMember } = await svc
        .from('company_users')
        .select('role, is_active')
        .eq('user_id', user.id)
        .eq('company_id', companyData.parent_company_id)
        .eq('is_active', true)
        .in('role', ['super_admin', 'system_admin'])
        .maybeSingle();
      effectiveMember = parentMember ?? null;
    }
  }

  if (!effectiveMember) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  // ── Montar condições de busca ─────────────────────────────────────────────
  const conditions: string[] = [];

  if (phone) {
    const lookupValues = buildPhoneLookupValues(String(phone));
    if (lookupValues.length > 0) {
      conditions.push(`phone_normalized.in.(${lookupValues.join(',')})`);
    }
  }

  const emailNorm = (email ?? '').trim().toLowerCase();
  if (emailNorm.includes('@')) {
    conditions.push(`email.ilike.${emailNorm}`);
  }

  if (conditions.length === 0) {
    return res.status(200).json({ isDuplicate: false });
  }

  // ── Buscar com service_role (ignora RLS — cobre restrict_leads_to_owner) ──
  const { data: found, error: queryError } = await svc
    .from('leads')
    .select('id, name, phone, email, responsible_user_id')
    .eq('company_id', company_id)
    .is('deleted_at', null)
    .or(conditions.join(','))
    .limit(1)
    .maybeSingle();

  if (queryError) {
    console.error('[check-duplicate] query error:', queryError);
    return res.status(500).json({ error: 'Erro ao verificar duplicata' });
  }

  if (!found) {
    return res.status(200).json({ isDuplicate: false });
  }

  // ── Buscar nome do responsável ────────────────────────────────────────────
  let responsibleName: string | null = null;
  if (found.responsible_user_id) {
    const { data: responsibleUser } = await svc
      .from('company_users')
      .select('display_name, email')
      .eq('user_id', found.responsible_user_id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle();

    responsibleName =
      responsibleUser?.display_name ||
      responsibleUser?.email ||
      'usuário não identificado';
  }

  // Inferir campo que gerou o match
  const matchedBy: 'phone' | 'email' =
    phone && found.phone ? 'phone' : 'email';

  return res.status(200).json({
    isDuplicate: true,
    existingLead: {
      id:                  found.id,
      name:                found.name,
      phone:               found.phone,
      email:               found.email,
      responsible_user_id: found.responsible_user_id,
      responsibleName,
      matchedBy,
    },
  });
}
