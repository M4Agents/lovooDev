// =====================================================
// API: ASSISTENTE DE CATEGORIZAÇÃO - INTERFACE AMIGÁVEL
// =====================================================
// Interface para categorizar arquivos durante migração
// Criado: 10/01/2026 10:15 - Categorização assistida

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =====================================================
// HELPER: ANÁLISE INTELIGENTE DE ARQUIVOS
// =====================================================

const analyzeFile = (filename, fileType, fileSize) => {
  const name = filename.toLowerCase()
  const suggestions = []
  let confidence = 0
  
  // ANÁLISE POR NOME DO ARQUIVO
  if (name.includes('chat') || name.includes('conversa') || name.includes('whatsapp')) {
    suggestions.push({ category: 'chat', reason: 'Nome contém palavras relacionadas a chat', confidence: 90 })
  }
  
  if (name.includes('marketing') || name.includes('banner') || name.includes('campanha') || 
      name.includes('masterclass') || name.includes('promocional') || name.includes('vendas')) {
    suggestions.push({ category: 'marketing', reason: 'Nome contém palavras de marketing', confidence: 85 })
  }
  
  if (name.includes('teste') || name.includes('test') || name.includes('exemplo') || 
      name.includes('demo')) {
    suggestions.push({ category: 'teste', reason: 'Nome indica arquivo de teste', confidence: 80 })
  }
  
  // ANÁLISE POR TIPO DE ARQUIVO
  if (fileType === 'image') {
    if (name.includes('logo') || name.includes('banner') || name.includes('poster')) {
      suggestions.push({ category: 'marketing', reason: 'Imagem promocional', confidence: 75 })
    }
    if (name.includes('screenshot') || name.includes('print') || name.includes('captura')) {
      suggestions.push({ category: 'chat', reason: 'Screenshot de conversa', confidence: 70 })
    }
  }
  
  if (fileType === 'document') {
    if (name.includes('catalogo') || name.includes('proposta') || name.includes('apresentacao')) {
      suggestions.push({ category: 'marketing', reason: 'Documento comercial', confidence: 80 })
    }
    if (name.includes('manual') || name.includes('instrucao') || name.includes('tutorial')) {
      suggestions.push({ category: 'teste', reason: 'Documento de instrução', confidence: 75 })
    }
  }
  
  // ANÁLISE POR TAMANHO
  if (fileSize > 5000000) { // > 5MB
    suggestions.push({ category: 'marketing', reason: 'Arquivo grande, possivelmente material promocional', confidence: 60 })
  }
  
  // DETERMINAR MELHOR SUGESTÃO
  if (suggestions.length > 0) {
    const bestSuggestion = suggestions.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    )
    return {
      suggested_category: bestSuggestion.category,
      confidence: bestSuggestion.confidence,
      reason: bestSuggestion.reason,
      all_suggestions: suggestions
    }
  }
  
  // PADRÃO: marketing
  return {
    suggested_category: 'marketing',
    confidence: 50,
    reason: 'Categorização padrão - requer revisão manual',
    all_suggestions: []
  }
}

// =====================================================
// HELPER: GERAR PREVIEW DO ARQUIVO
// =====================================================

const generateFilePreview = (file) => {
  const analysis = analyzeFile(file.filename, file.file_type, file.size)
  
  return {
    id: file.key,
    filename: file.filename,
    file_type: file.file_type,
    size: file.size,
    size_formatted: formatFileSize(file.size),
    current_location: file.key,
    preview_url: file.url,
    analysis,
    migration_preview: {
      chat: `biblioteca/companies/{company_id}/chat/${file.filename}`,
      marketing: `biblioteca/companies/{company_id}/marketing/${file.filename}`,
      teste: `biblioteca/companies/{company_id}/teste/${file.filename}`
    },
    last_modified: file.lastModified
  }
}

// =====================================================
// HELPER: FORMATAR TAMANHO DO ARQUIVO
// =====================================================

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  console.log('🎯 CATEGORIZATION ASSISTANT - 2026-01-10 10:15')
  console.log('🤖 ASSISTENTE INTELIGENTE DE CATEGORIZAÇÃO')
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas POST é permitido'
    })
  }

  try {
    const { company_id, action, file_selections } = req.body

    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    console.log('🎯 Categorização solicitada:', { 
      company_id, 
      action,
      selections: file_selections?.length || 0
    })

    // =====================================================
    // AÇÃO: ANALISAR ARQUIVOS PARA CATEGORIZAÇÃO
    // =====================================================
    
    if (action === 'analyze_files') {
      console.log('🔍 Analisando arquivos para categorização...')
      
      // SIMULAÇÃO: Arquivos da estrutura temporal para análise
      const temporalFiles = [
        {
          key: `biblioteca/companies/${company_id}/2025/12/30/masterclass_vendas.jpg`,
          filename: 'masterclass_vendas.jpg',
          file_type: 'image',
          size: 1024000,
          lastModified: '2025-12-30T10:00:00Z',
          url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/2025/12/30/masterclass_vendas.jpg`
        },
        {
          key: `biblioteca/companies/${company_id}/2025/12/30/conversa_cliente.jpg`,
          filename: 'conversa_cliente.jpg',
          file_type: 'image',
          size: 512000,
          lastModified: '2025-12-30T11:00:00Z',
          url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/2025/12/30/conversa_cliente.jpg`
        },
        {
          key: `biblioteca/companies/${company_id}/2025/12/30/documento_teste.pdf`,
          filename: 'documento_teste.pdf',
          file_type: 'document',
          size: 256000,
          lastModified: '2025-12-30T12:00:00Z',
          url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/2025/12/30/documento_teste.pdf`
        },
        {
          key: `biblioteca/companies/${company_id}/2025/12/30/banner_promocional.png`,
          filename: 'banner_promocional.png',
          file_type: 'image',
          size: 2048000,
          lastModified: '2025-12-30T13:00:00Z',
          url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/2025/12/30/banner_promocional.png`
        }
      ]
      
      const analyzedFiles = temporalFiles.map(file => generateFilePreview(file))
      
      // ESTATÍSTICAS DA ANÁLISE
      const stats = {
        total_files: analyzedFiles.length,
        high_confidence: analyzedFiles.filter(f => f.analysis.confidence >= 80).length,
        medium_confidence: analyzedFiles.filter(f => f.analysis.confidence >= 60 && f.analysis.confidence < 80).length,
        low_confidence: analyzedFiles.filter(f => f.analysis.confidence < 60).length,
        suggested_categories: {
          chat: analyzedFiles.filter(f => f.analysis.suggested_category === 'chat').length,
          marketing: analyzedFiles.filter(f => f.analysis.suggested_category === 'marketing').length,
          teste: analyzedFiles.filter(f => f.analysis.suggested_category === 'teste').length
        }
      }
      
      console.log('✅ Análise concluída:', stats)
      
      return res.status(200).json({
        success: true,
        action: 'files_analyzed',
        data: {
          company_id,
          analyzed_files: analyzedFiles,
          analysis_stats: stats,
          recommendations: {
            auto_migrate: analyzedFiles.filter(f => f.analysis.confidence >= 80),
            manual_review: analyzedFiles.filter(f => f.analysis.confidence < 80)
          },
          timestamp: new Date().toISOString()
        }
      })
    }

    // =====================================================
    // AÇÃO: APLICAR SELEÇÕES DO USUÁRIO
    // =====================================================
    
    if (action === 'apply_selections' && file_selections) {
      console.log('✅ Aplicando seleções do usuário...')
      
      const processedSelections = file_selections.map(selection => ({
        filename: selection.filename,
        original_category: selection.suggested_category,
        user_category: selection.selected_category,
        confidence: selection.user_confidence || 100,
        user_modified: selection.suggested_category !== selection.selected_category,
        new_location: `biblioteca/companies/${company_id}/${selection.selected_category}/${selection.filename}`
      }))
      
      const selectionStats = {
        total_selections: processedSelections.length,
        user_modified: processedSelections.filter(s => s.user_modified).length,
        auto_accepted: processedSelections.filter(s => !s.user_modified).length,
        categories: {
          chat: processedSelections.filter(s => s.user_category === 'chat').length,
          marketing: processedSelections.filter(s => s.user_category === 'marketing').length,
          teste: processedSelections.filter(s => s.user_category === 'teste').length
        }
      }
      
      console.log('✅ Seleções processadas:', selectionStats)
      
      return res.status(200).json({
        success: true,
        action: 'selections_applied',
        data: {
          company_id,
          processed_selections: processedSelections,
          selection_stats: selectionStats,
          ready_for_migration: true,
          next_step: 'execute_migration',
          timestamp: new Date().toISOString()
        }
      })
    }

    // =====================================================
    // AÇÃO: STATUS DO ASSISTENTE
    // =====================================================
    
    console.log('📊 Retornando status do assistente')
    
    return res.status(200).json({
      success: true,
      action: 'status',
      data: {
        company_id,
        assistant_features: [
          'Análise inteligente de nomes de arquivo',
          'Sugestões baseadas em tipo e tamanho',
          'Preview de nova localização',
          'Estatísticas de confiança',
          'Interface de revisão manual'
        ],
        available_categories: ['chat', 'marketing', 'teste'],
        analysis_criteria: [
          'Palavras-chave no nome do arquivo',
          'Tipo de arquivo (imagem, documento, etc.)',
          'Tamanho do arquivo',
          'Padrões de nomenclatura'
        ],
        confidence_levels: {
          high: '80-100% (migração automática recomendada)',
          medium: '60-79% (revisão sugerida)',
          low: '0-59% (revisão manual obrigatória)'
        }
      }
    })

  } catch (error) {
    console.error('❌ Erro no assistente:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro no assistente de categorização',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
