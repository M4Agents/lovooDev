import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

export default async function handler(req, res) {
  console.log('🔍 ENDPOINT CHAT-MEDIA CHAMADO:', {
    method: req.method,
    filename: req.query.filename,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  })

  if (req.method !== 'GET') {
    console.log('❌ MÉTODO NÃO PERMITIDO:', req.method)
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { filename } = req.query

  if (!filename) {
    console.log('❌ FILENAME AUSENTE')
    return res.status(400).json({ error: 'Filename is required' })
  }

  try {
    console.log('🔐 TENTANDO AUTENTICAÇÃO VIA COOKIES...')
    
    // Criar cliente Supabase com autenticação via cookies
    const supabase = createServerSupabaseClient({ req, res })
    
    // Verificar autenticação do usuário
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    console.log('👤 RESULTADO AUTENTICAÇÃO:', {
      hasUser: !!user,
      userId: user?.id,
      authError: authError?.message
    })
    
    if (authError || !user) {
      console.log('❌ FALHA NA AUTENTICAÇÃO')
      return res.status(401).json({ error: 'Authentication required' })
    }

    console.log('🏢 BUSCANDO COMPANY_ID DO USUÁRIO...')
    
    // Buscar company_id do usuário
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    console.log('🏢 RESULTADO COMPANY_ID:', {
      hasUserData: !!userData,
      companyId: userData?.company_id,
      userError: userError?.message
    })

    if (userError || !userData) {
      console.log('❌ USUÁRIO NÃO ENCONTRADO')
      return res.status(403).json({ error: 'User not found' })
    }

    const companyId = userData.company_id

    console.log('📁 VERIFICANDO PERMISSÃO DO ARQUIVO:', filename)
    
    // Verificar se o arquivo pertence à empresa do usuário
    const { data: messageData, error: messageError } = await supabase
      .from('chat_messages')
      .select('company_id')
      .eq('media_url', filename)
      .eq('company_id', companyId)
      .single()

    console.log('📁 RESULTADO VERIFICAÇÃO:', {
      hasMessageData: !!messageData,
      messageError: messageError?.message
    })

    if (messageError || !messageData) {
      console.log('❌ ARQUIVO NÃO ENCONTRADO OU SEM PERMISSÃO')
      return res.status(403).json({ error: 'File not found or access denied' })
    }

    console.log('🔗 GERANDO SIGNED URL...')
    
    // Criar cliente com service role para storage operations
    const storageClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Gerar signed URL (válida por 2 horas)
    const { data: signedUrlData, error: signedUrlError } = await storageClient.storage
      .from('chat-media')
      .createSignedUrl(filename, 7200) // 2 horas = 7200 segundos

    console.log('🔗 RESULTADO SIGNED URL:', {
      hasSignedUrl: !!signedUrlData?.signedUrl,
      signedUrlError: signedUrlError?.message
    })

    if (signedUrlError || !signedUrlData) {
      console.log('❌ FALHA AO GERAR SIGNED URL')
      return res.status(500).json({ error: 'Failed to generate signed URL' })
    }

    console.log('✅ REDIRECIONANDO PARA SIGNED URL')
    
    // Redirecionar para a URL assinada
    res.redirect(302, signedUrlData.signedUrl)

  } catch (error) {
    console.error('Error in chat-media endpoint:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
