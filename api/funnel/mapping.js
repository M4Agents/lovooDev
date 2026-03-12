// =====================================================
// API ENDPOINT: Mapeamento de Funis e Etapas
// Data: 03/03/2026
// Objetivo: Retornar funis e etapas com slugs para integração
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Apenas GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { api_key } = req.query;

    // Validar API Key
    if (!api_key) {
      return res.status(400).json({ 
        error: 'API Key é obrigatória',
        message: 'Inclua o parâmetro api_key na URL'
      });
    }

    // Criar cliente Supabase com service role para bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar empresa pela API Key
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name')
      .eq('api_key', api_key)
      .single();

    if (companyError || !company) {
      return res.status(401).json({ 
        error: 'API Key inválida',
        message: 'Verifique sua API Key em Configurações > API'
      });
    }

    // Buscar funis da empresa
    const { data: funnels, error: funnelsError } = await supabase
      .from('sales_funnels')
      .select(`
        id,
        name,
        slug,
        description,
        is_default,
        is_active
      `)
      .eq('company_id', company.id)
      .eq('is_active', true)
      .order('is_default', { ascending: false });

    if (funnelsError) {
      console.error('Error fetching funnels:', funnelsError);
      return res.status(500).json({ 
        error: 'Erro ao buscar funis',
        message: funnelsError.message 
      });
    }

    // Buscar etapas de cada funil
    const funnelsWithStages = await Promise.all(
      funnels.map(async (funnel) => {
        const { data: stages, error: stagesError } = await supabase
          .from('funnel_stages')
          .select(`
            id,
            name,
            slug,
            external_id,
            description,
            color,
            position,
            stage_type,
            is_system_stage
          `)
          .eq('funnel_id', funnel.id)
          .order('position', { ascending: true });

        if (stagesError) {
          console.error('Error fetching stages:', stagesError);
          return { ...funnel, stages: [] };
        }

        return {
          ...funnel,
          stages: stages || []
        };
      })
    );

    // Retornar mapeamento completo
    return res.status(200).json({
      success: true,
      company: {
        id: company.id,
        name: company.name
      },
      funnels: funnelsWithStages,
      total_funnels: funnelsWithStages.length,
      total_stages: funnelsWithStages.reduce((sum, f) => sum + f.stages.length, 0)
    });

  } catch (error) {
    console.error('Error in funnel mapping API:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
}
