import { createClient } from '@supabase/supabase-js';
import { dispatchLeadCreatedTrigger } from '../lib/automation/dispatchLeadCreatedTrigger.js';
import { getPlanLimits, checkLimit } from '../lib/plans/limitChecker.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Service role separado exclusivamente para leitura de limites de plano.
// ANON_KEY não tem visibilidade garantida sobre plans (RLS restritiva).
function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export default async function handler(req, res) {
  // Permitir apenas métodos POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      api_key,
      name,
      email,
      phone,
      origin = 'api',
      status = 'novo',
      interest,
      visitor_id,
      custom_fields,
      // Campos da empresa
      company_name,
      company_cnpj,
      company_razao_social,
      company_nome_fantasia,
      company_cep,
      company_cidade,
      company_estado,
      company_endereco,
      company_telefone,
      company_email,
      company_site
    } = req.body;

    // Validar API Key
    if (!api_key) {
      return res.status(401).json({ error: 'API Key is required' });
    }

    // Buscar empresa pela API Key
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name, status')
      .eq('api_key', api_key)
      .eq('status', 'active')
      .single();

    if (companyError || !company) {
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    // Validar dados obrigatórios
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Validar email se fornecido
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // ── VERIFICAÇÃO DE LIMITE: max_leads (sem bloqueio) ───────────────────────
    // Lead SEMPRE é criado. Se a empresa estiver acima do limite, o lead
    // é marcado com is_over_plan = true para controle de visibilidade.
    // NULL em max_leads = ilimitado → is_over_plan nunca é true.
    let isOverPlan = false
    try {
      const svc    = getServiceClient()
      const limits = await getPlanLimits(svc, company.id)

      if (limits.max_leads !== null) {
        const { count: leadsCount, error: countErr } = await svc
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', company.id)
          .is('deleted_at', null)

        if (countErr) {
          console.warn('[leads/create] falha ao contar leads para check de limite:', countErr.message)
        } else {
          const check = checkLimit(limits.max_leads, leadsCount ?? 0)
          isOverPlan = !check.allowed
          if (isOverPlan) {
            console.info(
              `[leads/create] empresa ${company.id} acima do limite de leads ` +
              `(${check.current}/${check.limit}) — lead será criado com is_over_plan=true`
            )
          }
        }
      }
    } catch (err) {
      console.error('[leads/create] erro no check de limite max_leads:', err?.message)
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Criar lead (sempre — is_over_plan marca visibilidade restrita se acima do plano)
    const leadData = {
      company_id: company.id,
      name,
      email: email || null,
      phone: phone || null,
      origin,
      status,
      interest: interest || null,
      visitor_id: visitor_id || null,
      is_over_plan: isOverPlan,
      // Campos da empresa
      company_name: company_name || null,
      company_cnpj: company_cnpj || null,
      company_razao_social: company_razao_social || null,
      company_nome_fantasia: company_nome_fantasia || null,
      company_cep: company_cep || null,
      company_cidade: company_cidade || null,
      company_estado: company_estado || null,
      company_endereco: company_endereco || null,
      company_telefone: company_telefone || null,
      company_email: company_email || null,
      company_site: company_site || null
    };

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert(leadData)
      .select()
      .single();

    if (leadError) {
      console.error('Error creating lead:', leadError);
      return res.status(500).json({ error: 'Failed to create lead' });
    }

    // Se há campos personalizados, inserir os valores
    if (custom_fields && typeof custom_fields === 'object') {
      // Buscar campos personalizados da empresa
      const { data: companyFields } = await supabase
        .from('lead_custom_fields')
        .select('id, field_name')
        .eq('company_id', company.id);

      if (companyFields && companyFields.length > 0) {
        const customValues = [];
        
        for (const field of companyFields) {
          if (custom_fields[field.field_name] !== undefined) {
            customValues.push({
              lead_id: lead.id,
              field_id: field.id,
              value: String(custom_fields[field.field_name])
            });
          }
        }

        if (customValues.length > 0) {
          const { error: customError } = await supabase
            .from('lead_custom_values')
            .insert(customValues);

          if (customError) {
            console.error('Error inserting custom field values:', customError);
          }
        }
      }
    }

    // Disparar automação backend (fire-and-forget — nunca bloqueia a resposta)
    dispatchLeadCreatedTrigger({ companyId: company.id, leadId: lead.id, source: 'api' })
      .catch(err => console.error('[api/leads/create] automation trigger failed:', err))

    // Retornar sucesso
    res.status(201).json({
      success: true,
      lead: {
        id:           lead.id,
        name:         lead.name,
        email:        lead.email,
        phone:        lead.phone,
        origin:       lead.origin,
        status:       lead.status,
        is_over_plan: lead.is_over_plan,
        created_at:   lead.created_at
      },
      is_over_plan: lead.is_over_plan,
      message: lead.is_over_plan
        ? 'Lead created (plan limit reached — lead marked as restricted)'
        : 'Lead created successfully'
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
