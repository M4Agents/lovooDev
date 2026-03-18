// =====================================================
// SERVICE: CRM SERVICE (AUTOMATION)
// Data: 13/03/2026
// Objetivo: Ações de CRM via automação (criar oportunidade, atualizar lead, etc)
// IMPORTANTE: Não altera sistema existente, apenas adiciona funcionalidade
// =====================================================

import { supabase } from '../../lib/supabase'

interface CreateOpportunityParams {
  leadId: number
  companyId: string
  funnelId?: string
  stageId?: string
  title?: string
  value?: number
  probability?: number
}

interface UpdateLeadParams {
  leadId: number
  companyId: string
  fields: Record<string, any>
}

interface AddTagParams {
  leadId: number
  companyId: string
  tagName: string
}

interface AssignOwnerParams {
  leadId: number
  companyId: string
  ownerId: string
}

export class CRMService {
  /**
   * Cria uma oportunidade no funil de vendas
   */
  async createOpportunity(params: CreateOpportunityParams): Promise<any> {
    try {
      console.log('🎯 CRMService: Criando oportunidade', {
        leadId: params.leadId,
        funnelId: params.funnelId
      })

      // Buscar lead
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('name, email, phone')
        .eq('id', params.leadId)
        .single()

      if (leadError || !lead) {
        throw new Error('Lead não encontrado')
      }

      // Se não foi especificado funil, buscar o primeiro funil ativo da empresa
      let funnelId = params.funnelId
      let stageId = params.stageId

      if (!funnelId) {
        const { data: funnel } = await supabase
          .from('sales_funnels')
          .select('id')
          .eq('company_id', params.companyId)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        if (funnel) {
          funnelId = funnel.id
        } else {
          throw new Error('Nenhum funil ativo encontrado')
        }
      }

      // Se não foi especificada etapa, buscar a primeira etapa do funil
      if (!stageId) {
        const { data: stage } = await supabase
          .from('funnel_stages')
          .select('id')
          .eq('funnel_id', funnelId)
          .order('order_index', { ascending: true })
          .limit(1)
          .single()

        if (stage) {
          stageId = stage.id
        } else {
          throw new Error('Nenhuma etapa encontrada no funil')
        }
      }

      // Criar oportunidade
      const opportunity = {
        company_id: params.companyId,
        lead_id: params.leadId,
        funnel_id: funnelId,
        stage_id: stageId,
        title: params.title || `Oportunidade - ${lead.name}`,
        value: params.value || 0,
        probability: params.probability || 50,
        status: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('opportunities')
        .insert(opportunity)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Oportunidade criada:', data.id)

      return {
        success: true,
        opportunityId: data.id,
        opportunity: data
      }
    } catch (error: any) {
      console.error('❌ Erro ao criar oportunidade:', error)
      throw error
    }
  }

  /**
   * Atualiza campos de um lead
   */
  async updateLead(params: UpdateLeadParams): Promise<any> {
    try {
      console.log('📝 CRMService: Atualizando lead', {
        leadId: params.leadId,
        fields: Object.keys(params.fields)
      })

      // Adicionar updated_at
      const updates = {
        ...params.fields,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', params.leadId)
        .eq('company_id', params.companyId)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Lead atualizado')

      return {
        success: true,
        lead: data
      }
    } catch (error: any) {
      console.error('❌ Erro ao atualizar lead:', error)
      throw error
    }
  }

  /**
   * Adiciona uma tag ao lead
   */
  async addTag(params: AddTagParams): Promise<any> {
    try {
      console.log('🏷️ CRMService: Adicionando tag', {
        leadId: params.leadId,
        tagName: params.tagName
      })

      // Buscar ou criar tag
      let tagId: string

      const { data: existingTag } = await supabase
        .from('tags')
        .select('id')
        .eq('company_id', params.companyId)
        .eq('name', params.tagName)
        .single()

      if (existingTag) {
        tagId = existingTag.id
      } else {
        // Criar nova tag
        const { data: newTag, error: tagError } = await supabase
          .from('tags')
          .insert({
            company_id: params.companyId,
            name: params.tagName,
            color: this.getRandomColor(),
            created_at: new Date().toISOString()
          })
          .select()
          .single()

        if (tagError) throw tagError
        tagId = newTag.id
      }

      // Verificar se já existe a relação
      const { data: existing } = await supabase
        .from('lead_tags')
        .select('id')
        .eq('lead_id', params.leadId)
        .eq('tag_id', tagId)
        .single()

      if (existing) {
        console.log('ℹ️ Tag já existe no lead')
        return {
          success: true,
          tagId,
          alreadyExists: true
        }
      }

      // Adicionar tag ao lead
      const { error } = await supabase
        .from('lead_tags')
        .insert({
          lead_id: params.leadId,
          tag_id: tagId,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      console.log('✅ Tag adicionada ao lead')

      return {
        success: true,
        tagId
      }
    } catch (error: any) {
      console.error('❌ Erro ao adicionar tag:', error)
      throw error
    }
  }

  /**
   * Remove uma tag do lead
   */
  async removeTag(params: AddTagParams): Promise<any> {
    try {
      console.log('🏷️ CRMService: Removendo tag', {
        leadId: params.leadId,
        tagName: params.tagName
      })

      // Buscar tag
      const { data: tag } = await supabase
        .from('tags')
        .select('id')
        .eq('company_id', params.companyId)
        .eq('name', params.tagName)
        .single()

      if (!tag) {
        console.log('ℹ️ Tag não encontrada')
        return { success: true, notFound: true }
      }

      // Remover relação
      const { error } = await supabase
        .from('lead_tags')
        .delete()
        .eq('lead_id', params.leadId)
        .eq('tag_id', tag.id)

      if (error) throw error

      console.log('✅ Tag removida do lead')

      return {
        success: true
      }
    } catch (error: any) {
      console.error('❌ Erro ao remover tag:', error)
      throw error
    }
  }

  /**
   * Atribui um responsável (owner) ao lead
   */
  async assignOwner(params: AssignOwnerParams): Promise<any> {
    try {
      console.log('👤 CRMService: Atribuindo responsável', {
        leadId: params.leadId,
        ownerId: params.ownerId
      })

      // Verificar se o usuário existe e pertence à empresa
      const { data: user } = await supabase
        .from('users')
        .select('id, name')
        .eq('id', params.ownerId)
        .single()

      if (!user) {
        throw new Error('Usuário não encontrado')
      }

      // Atualizar lead
      const { data, error } = await supabase
        .from('leads')
        .update({
          responsible_user_id: params.ownerId,
          updated_at: new Date().toISOString()
        })
        .eq('id', params.leadId)
        .eq('company_id', params.companyId)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Responsável atribuído:', user.name)

      return {
        success: true,
        ownerId: params.ownerId,
        ownerName: user.name
      }
    } catch (error: any) {
      console.error('❌ Erro ao atribuir responsável:', error)
      throw error
    }
  }

  /**
   * Marca oportunidade como ganha
   */
  async winOpportunity(opportunityId: string, companyId: string, params?: {
    finalValue?: number;
    closeDate?: string;
    notes?: string;
  }): Promise<any> {
    try {
      console.log('🎉 CRMService: Marcando oportunidade como ganha', {
        opportunityId,
        finalValue: params?.finalValue
      })

      const updateData: any = {
        status: 'won',
        closed_at: params?.closeDate || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      if (params?.finalValue !== undefined) {
        updateData.value = params.finalValue
      }

      if (params?.notes) {
        updateData.notes = params.notes
      }

      const { data, error } = await supabase
        .from('opportunities')
        .update(updateData)
        .eq('id', opportunityId)
        .eq('company_id', companyId)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Oportunidade marcada como ganha')

      return {
        success: true,
        opportunity: data
      }
    } catch (error: any) {
      console.error('❌ Erro ao marcar oportunidade como ganha:', error)
      throw error
    }
  }

  /**
   * Marca oportunidade como perdida
   */
  async loseOpportunity(opportunityId: string, companyId: string, params: {
    lossReason?: string;
    notes?: string;
  }): Promise<any> {
    try {
      console.log('😞 CRMService: Marcando oportunidade como perdida', {
        opportunityId,
        lossReason: params.lossReason
      })

      const updateData: any = {
        status: 'lost',
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      if (params.lossReason) {
        updateData.loss_reason = params.lossReason
      }

      if (params.notes) {
        updateData.notes = params.notes
      }

      const { data, error } = await supabase
        .from('opportunities')
        .update(updateData)
        .eq('id', opportunityId)
        .eq('company_id', companyId)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Oportunidade marcada como perdida')

      return {
        success: true,
        opportunity: data
      }
    } catch (error: any) {
      console.error('❌ Erro ao marcar oportunidade como perdida:', error)
      throw error
    }
  }

  /**
   * Move oportunidade para outra etapa
   */
  async moveOpportunity(opportunityId: string, stageId: string, companyId: string): Promise<any> {
    try {
      console.log('🔄 CRMService: Movendo oportunidade', {
        opportunityId,
        stageId
      })

      const { data, error } = await supabase
        .from('opportunities')
        .update({
          stage_id: stageId,
          updated_at: new Date().toISOString()
        })
        .eq('id', opportunityId)
        .eq('company_id', companyId)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Oportunidade movida')

      return {
        success: true,
        opportunity: data
      }
    } catch (error: any) {
      console.error('❌ Erro ao mover oportunidade:', error)
      throw error
    }
  }

  /**
   * Gera uma cor aleatória para tags
   */
  private getRandomColor(): string {
    const colors = [
      '#3B82F6', // blue
      '#10B981', // green
      '#F59E0B', // yellow
      '#EF4444', // red
      '#8B5CF6', // purple
      '#EC4899', // pink
      '#06B6D4', // cyan
      '#F97316'  // orange
    ]
    return colors[Math.floor(Math.random() * colors.length)]
  }
}

// Exportar instância singleton
export const crmService = new CRMService()
