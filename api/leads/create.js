import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
      custom_fields
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

    // Criar lead
    const leadData = {
      company_id: company.id,
      name,
      email: email || null,
      phone: phone || null,
      origin,
      status,
      interest: interest || null,
      visitor_id: visitor_id || null
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

    // Retornar sucesso
    res.status(201).json({
      success: true,
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        origin: lead.origin,
        status: lead.status,
        created_at: lead.created_at
      },
      message: 'Lead created successfully'
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
