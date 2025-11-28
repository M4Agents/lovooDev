// API de Tags para Leads
// Data: 2025-11-28

import { supabase } from '../lib/supabase';
import { Tag, TagFormData } from '../types/tags';

export const tagsApi = {
  // Listar todas as tags da empresa
  async getTags(companyId: string): Promise<Tag[]> {
    console.log('API: getTags called for company:', companyId);
    
    try {
      const { data, error } = await supabase
        .from('lead_tags')
        .select(`
          *,
          leads_count:lead_tag_assignments(count)
        `)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('name');

      if (error) {
        console.error('Error fetching tags:', error);
        throw error;
      }

      // Processar contagem de leads
      const tags = data?.map((tag: any) => ({
        ...tag,
        leads_count: tag.leads_count?.[0]?.count || 0
      })) || [];

      console.log('API: Tags retrieved successfully:', tags.length);
      return tags;
    } catch (error) {
      console.error('Error in getTags:', error);
      throw error;
    }
  },

  // Criar nova tag
  async createTag(companyId: string, tagData: TagFormData): Promise<Tag> {
    console.log('API: createTag called:', { companyId, tagData });
    
    try {
      const { data, error } = await supabase
        .from('lead_tags')
        .insert({
          company_id: companyId,
          name: tagData.name.trim(),
          color: tagData.color,
          description: tagData.description?.trim() || null
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating tag:', error);
        throw error;
      }

      console.log('API: Tag created successfully:', data);
      return data;
    } catch (error) {
      console.error('Error in createTag:', error);
      throw error;
    }
  },

  // Atualizar tag existente
  async updateTag(tagId: string, tagData: Partial<TagFormData>): Promise<Tag> {
    console.log('API: updateTag called:', { tagId, tagData });
    
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (tagData.name) updateData.name = tagData.name.trim();
      if (tagData.color) updateData.color = tagData.color;
      if (tagData.description !== undefined) {
        updateData.description = tagData.description?.trim() || null;
      }

      const { data, error } = await supabase
        .from('lead_tags')
        .update(updateData)
        .eq('id', tagId)
        .select()
        .single();

      if (error) {
        console.error('Error updating tag:', error);
        throw error;
      }

      console.log('API: Tag updated successfully:', data);
      return data;
    } catch (error) {
      console.error('Error in updateTag:', error);
      throw error;
    }
  },

  // Verificar se tag pode ser excluída
  async canDeleteTag(tagId: string): Promise<boolean> {
    console.log('API: canDeleteTag called:', tagId);
    
    try {
      const { data, error } = await supabase
        .rpc('can_delete_tag', { tag_uuid: tagId });

      if (error) {
        console.error('Error checking if tag can be deleted:', error);
        throw error;
      }

      console.log('API: Can delete tag result:', data);
      return data;
    } catch (error) {
      console.error('Error in canDeleteTag:', error);
      throw error;
    }
  },

  // Excluir tag (soft delete)
  async deleteTag(tagId: string): Promise<void> {
    console.log('API: deleteTag called:', tagId);
    
    try {
      // Primeiro verificar se pode excluir
      const canDelete = await this.canDeleteTag(tagId);
      if (!canDelete) {
        throw new Error('Não é possível excluir esta tag pois ela está vinculada a leads');
      }

      const { error } = await supabase
        .from('lead_tags')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', tagId);

      if (error) {
        console.error('Error deleting tag:', error);
        throw error;
      }

      console.log('API: Tag deleted successfully');
    } catch (error) {
      console.error('Error in deleteTag:', error);
      throw error;
    }
  },

  // Obter tags de um lead específico
  async getLeadTags(leadId: number): Promise<Tag[]> {
    console.log('API: getLeadTags called for lead:', leadId);
    
    try {
      const { data, error } = await supabase
        .from('lead_tag_assignments')
        .select(`
          tag_id,
          lead_tags (
            id,
            company_id,
            name,
            color,
            description,
            is_active,
            created_at,
            updated_at
          )
        `)
        .eq('lead_id', leadId);

      if (error) {
        console.error('Error fetching lead tags:', error);
        throw error;
      }

      const tags = data?.map((assignment: any) => assignment.lead_tags).filter(Boolean) || [];
      console.log('API: Lead tags retrieved successfully:', tags.length);
      return tags as Tag[];
    } catch (error) {
      console.error('Error in getLeadTags:', error);
      throw error;
    }
  },

  // Atualizar tags de um lead
  async updateLeadTags(leadId: number, tagIds: string[]): Promise<void> {
    console.log('API: updateLeadTags called:', { leadId, tagIds });
    
    try {
      // Remover todas as tags existentes do lead
      const { error: deleteError } = await supabase
        .from('lead_tag_assignments')
        .delete()
        .eq('lead_id', leadId);

      if (deleteError) {
        console.error('Error removing existing lead tags:', deleteError);
        throw deleteError;
      }

      // Adicionar as novas tags
      if (tagIds.length > 0) {
        const assignments = tagIds.map(tagId => ({
          lead_id: leadId,
          tag_id: tagId
        }));

        const { error: insertError } = await supabase
          .from('lead_tag_assignments')
          .insert(assignments);

        if (insertError) {
          console.error('Error inserting new lead tags:', insertError);
          throw insertError;
        }
      }

      console.log('API: Lead tags updated successfully');
    } catch (error) {
      console.error('Error in updateLeadTags:', error);
      throw error;
    }
  },

  // Adicionar tag a um lead
  async addTagToLead(leadId: number, tagId: string): Promise<void> {
    console.log('API: addTagToLead called:', { leadId, tagId });
    
    try {
      const { error } = await supabase
        .from('lead_tag_assignments')
        .insert({
          lead_id: leadId,
          tag_id: tagId
        });

      if (error) {
        console.error('Error adding tag to lead:', error);
        throw error;
      }

      console.log('API: Tag added to lead successfully');
    } catch (error) {
      console.error('Error in addTagToLead:', error);
      throw error;
    }
  },

  // Remover tag de um lead
  async removeTagFromLead(leadId: number, tagId: string): Promise<void> {
    console.log('API: removeTagFromLead called:', { leadId, tagId });
    
    try {
      const { error } = await supabase
        .from('lead_tag_assignments')
        .delete()
        .eq('lead_id', leadId)
        .eq('tag_id', tagId);

      if (error) {
        console.error('Error removing tag from lead:', error);
        throw error;
      }

      console.log('API: Tag removed from lead successfully');
    } catch (error) {
      console.error('Error in removeTagFromLead:', error);
      throw error;
    }
  }
};
