import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { filename } = req.query

  if (!filename) {
    return res.status(400).json({ error: 'Filename is required' })
  }

  try {
    // Verificar autenticação do usuário
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    // Buscar company_id do usuário
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      return res.status(403).json({ error: 'User not found' })
    }

    const companyId = userData.company_id

    // Verificar se o arquivo pertence à empresa do usuário
    const { data: messageData, error: messageError } = await supabase
      .from('chat_messages')
      .select('company_id')
      .eq('media_url', filename)
      .eq('company_id', companyId)
      .single()

    if (messageError || !messageData) {
      return res.status(403).json({ error: 'File not found or access denied' })
    }

    // Gerar signed URL (válida por 2 horas)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('chat-media')
      .createSignedUrl(filename, 7200) // 2 horas = 7200 segundos

    if (signedUrlError || !signedUrlData) {
      return res.status(500).json({ error: 'Failed to generate signed URL' })
    }

    // Redirecionar para a URL assinada
    res.redirect(302, signedUrlData.signedUrl)

  } catch (error) {
    console.error('Error in chat-media endpoint:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
