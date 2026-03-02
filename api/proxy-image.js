// =====================================================
// API PROXY PARA IMAGENS - BYPASS CORS
// =====================================================
// Busca imagem server-side e retorna para cliente

export default async function handler(req, res) {
  console.log('🖼️ API proxy-image chamada')
  
  try {
    const { url } = req.query
    
    if (!url) {
      return res.status(400).json({ error: 'URL é obrigatória' })
    }

    console.log('📥 Buscando imagem:', url.substring(0, 50) + '...')

    // Fetch server-side (sem CORS)
    const response = await fetch(url)
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    // Pegar buffer da imagem
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    console.log('✅ Imagem baixada, tamanho:', buffer.length)

    // Retornar imagem com headers corretos
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg')
    res.setHeader('Content-Length', buffer.length)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'public, max-age=31536000')
    
    return res.send(buffer)

  } catch (error) {
    console.error('❌ Erro ao buscar imagem:', error)
    return res.status(500).json({ 
      error: 'Erro ao buscar imagem',
      message: error.message 
    })
  }
}
