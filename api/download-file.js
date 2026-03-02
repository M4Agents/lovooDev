// =====================================================
// API DE DOWNLOAD SEGURO DE ARQUIVOS - VERSÃO SIMPLIFICADA
// =====================================================
// TEMPORÁRIO: Sem Supabase para testar se problema é com import

export default async function handler(req, res) {
  console.log('🔥 API download-file chamada - VERSÃO SIMPLIFICADA')
  console.log('📋 Method:', req.method)
  console.log('📋 Query:', req.query)
  
  try {
    const { url } = req.query
    
    if (!url) {
      console.log('❌ URL faltando')
      return res.status(400).json({ error: 'URL é obrigatória' })
    }

    console.log('✅ URL recebida:', url)

    // Fazer redirect 302 direto para URL
    res.writeHead(302, {
      'Location': url,
      'Content-Disposition': 'attachment'
    })
    
    console.log('✅ Redirect enviado')
    return res.end()

  } catch (error) {
    console.error('❌ ERRO:', error)
    return res.status(500).json({ 
      error: error.message
    })
  }
}
