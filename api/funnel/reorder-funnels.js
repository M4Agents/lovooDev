// =====================================================
// API ENDPOINT: Reordenar Funis
// Data: 06/03/2026
// Objetivo: Atualizar display_order dos funis (drag & drop)
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { company_id, funnels } = req.body;

    // Validações
    if (!company_id) {
      return res.status(400).json({ 
        error: 'ID da empresa é obrigatório',
        field: 'company_id'
      });
    }

    if (!funnels || !Array.isArray(funnels) || funnels.length === 0) {
      return res.status(400).json({ 
        error: 'Lista de funis é obrigatória',
        field: 'funnels'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Atualizar display_order em lote
    const updates = [];
    for (const funnel of funnels) {
      if (!funnel.id || funnel.display_order === undefined) {
        return res.status(400).json({ 
          error: 'Cada funil deve ter id e display_order',
          field: 'funnels'
        });
      }

      const { error: updateError } = await supabase
        .from('sales_funnels')
        .update({ display_order: funnel.display_order })
        .eq('id', funnel.id)
        .eq('company_id', company_id);

      if (updateError) {
        throw updateError;
      }

      updates.push({ id: funnel.id, display_order: funnel.display_order });
    }

    return res.status(200).json({
      success: true,
      message: 'Funis reordenados com sucesso',
      updated_count: updates.length
    });

  } catch (error) {
    console.error('Error in reorder funnels API:', error);
    return res.status(500).json({ 
      error: 'Erro ao reordenar funis',
      message: error.message
    });
  }
}
