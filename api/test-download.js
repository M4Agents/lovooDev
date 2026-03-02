// API de teste simples para verificar se Vercel está executando
module.exports = async function handler(req, res) {
  console.log('🔥 TEST API CHAMADA')
  
  try {
    return res.status(200).json({ 
      success: true,
      message: 'API funcionando',
      query: req.query
    })
  } catch (error) {
    console.error('❌ ERRO:', error)
    return res.status(500).json({ error: error.message })
  }
}
