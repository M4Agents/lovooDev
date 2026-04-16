// POST /api/companies/update
// Atualiza dados de uma empresa com autorização via RPC (Trilha 1 + Trilha 2).
// Autorização: admin da própria empresa OU super_admin/system_admin da empresa pai.
// Operação final: service_role (apenas após validação completa).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Campos que o frontend pode enviar — qualquer outro é silenciosamente descartado.
// Nomes alinhados com as colunas reais da tabela companies.
const ALLOWED_FIELDS = new Set([
  // Identificação
  'name',
  'nome_fantasia',
  'razao_social',
  'cnpj',
  'inscricao_estadual',
  'inscricao_municipal',
  'tipo_empresa',
  'porte_empresa',
  'ramo_atividade',
  'data_fundacao',
  'descricao_empresa',
  // Endereço
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'estado',
  'pais',
  'endereco_correspondencia',
  // Contato
  'telefone_principal',
  'telefone_secundario',
  'whatsapp',
  'email_principal',
  'email_comercial',
  'email_financeiro',
  'email_suporte',
  // Online
  'site_principal',
  'url_google_business',
  'redes_sociais',
  'dominios_secundarios',
  'urls_landing_pages',
  // Responsáveis
  'responsavel_principal',
  'contato_financeiro',
  // Integração / IA
  'webhook_url',
  'ai_profile',
  'timezone',
  // Campos para agentes de IA conversacional e Prompt Builder
  'ponto_referencia',
  'horario_atendimento',
]);

// Campos estruturais que nunca podem ser alterados por esta rota.
const BLOCKED_FIELDS = new Set([
  'id',
  'company_type',
  'parent_company_id',
  'user_id',
  'created_at',
  'is_active',
]);

// Validações de formato para campos críticos (apenas quando presentes e não vazios).
const FIELD_VALIDATORS = {
  email_principal:    (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  email_comercial:    (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  email_financeiro:   (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  email_suporte:      (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  cnpj:               (v) => typeof v === 'string' && /^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(v.trim()),
  site_principal:     (v) => typeof v === 'string' && v.trim().length <= 500,
  telefone_principal: (v) => typeof v === 'string' && v.trim().length <= 30,
  telefone_secundario:(v) => typeof v === 'string' && v.trim().length <= 30,
  cep:                (v) => typeof v === 'string' && /^\d{5}-?\d{3}$/.test(v.trim()),
  ponto_referencia:   (v) => typeof v === 'string' && v.trim().length <= 300,
  horario_atendimento:(v) => typeof v === 'string' && v.trim().length <= 300,
};

function buildSafeUpdates(rawUpdates) {
  const blocked = [];
  const ignored = [];
  const safe = {};

  for (const [key, value] of Object.entries(rawUpdates)) {
    if (BLOCKED_FIELDS.has(key)) {
      blocked.push(key);
      continue;
    }
    if (!ALLOWED_FIELDS.has(key)) {
      ignored.push(key);
      continue;
    }
    safe[key] = value;
  }

  return { safe, blocked, ignored };
}

function validateFields(safeUpdates) {
  const errors = [];

  for (const [field, validator] of Object.entries(FIELD_VALIDATORS)) {
    if (field in safeUpdates && safeUpdates[field] !== null && safeUpdates[field] !== '') {
      if (!validator(safeUpdates[field])) {
        errors.push({ field, message: `Formato inválido para o campo "${field}"` });
      }
    }
  }

  return errors;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  if (!SUPABASE_SERVICE_KEY) {
    console.error('[companies/update] SUPABASE_SERVICE_ROLE_KEY não configurada');
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  // 1. Autenticação
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' });
  }
  const userToken = authHeader.split(' ')[1];

  // 2. Validar payload
  const { companyId, updates } = req.body ?? {};

  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'companyId obrigatório' });
  }

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates deve ser um objeto' });
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  }

  // 3. Aplicar allowlist e blocklist antes de qualquer operação
  const { safe, blocked, ignored } = buildSafeUpdates(updates);

  if (blocked.length > 0) {
    return res.status(400).json({
      error: 'Campos não permitidos',
      details: { blocked },
    });
  }

  if (Object.keys(safe).length === 0) {
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
  }

  // Log de campos descartados para rastreabilidade
  if (ignored.length > 0) {
    console.warn('[companies/update] Campos ignorados (fora do allowlist):', { companyId, ignored });
  }

  // 4. Validar formato de campos críticos
  const validationErrors = validateFields(safe);
  if (validationErrors.length > 0) {
    return res.status(422).json({
      error: 'Dados inválidos',
      details: validationErrors,
    });
  }

  // 5. Autorização via RPC (nunca confiar no frontend)
  // Usar cliente com token do usuário para que as RPCs avaliem auth.uid() corretamente.
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });

  const [adminResult, parentAdminResult] = await Promise.all([
    supabaseUser.rpc('auth_user_is_company_admin', { p_company_id: companyId }),
    supabaseUser.rpc('auth_user_is_parent_admin',  { p_company_id: companyId }),
  ]);

  const isAdmin       = adminResult.data === true;
  const isParentAdmin = parentAdminResult.data === true;

  if (!isAdmin && !isParentAdmin) {
    console.warn('[companies/update] Acesso negado:', {
      companyId,
      isAdmin,
      isParentAdmin,
      adminError: adminResult.error?.message,
      parentAdminError: parentAdminResult.error?.message,
    });
    return res.status(403).json({ error: 'Permissão insuficiente para atualizar esta empresa' });
  }

  // 6. Normalizar campos de texto livre antes de persistir
  const TEXT_FREE_FIELDS = ['ponto_referencia', 'horario_atendimento'];
  for (const field of TEXT_FREE_FIELDS) {
    if (typeof safe[field] === 'string') {
      safe[field] = safe[field].trim().replace(/\s{2,}/g, ' ') || null;
    }
  }

  // 7. Operação final com service_role (sem RLS, pois autorização já foi validada acima)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data, error } = await supabase
    .from('companies')
    .update({ ...safe, updated_at: new Date().toISOString() })
    .eq('id', companyId)
    .select()
    .single();

  if (error) {
    console.error('[companies/update] Erro ao atualizar empresa:', { companyId, error: error.message });
    return res.status(500).json({ error: 'Erro ao atualizar dados da empresa' });
  }

  console.log('[companies/update] Empresa atualizada:', {
    companyId,
    fields: Object.keys(safe),
    role: isParentAdmin ? 'parent_admin' : 'company_admin',
  });

  return res.status(200).json({ company: data });
}
