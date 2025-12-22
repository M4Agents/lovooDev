// Webhook Uazapi - ENDPOINT EM STANDBY
// Endpoint: /api/webhook/uazapi
// STATUS: DESATIVADO TEMPORARIAMENTE (22/12/2025)
// MOTIVO: Evitar duplicidade com /api/uazapi-webhook-final
// PARA REATIVAR: Descomentar código abaixo

export default async function handler(req, res) {
  // WEBHOOK EM STANDBY - Retorna sucesso sem processar
  console.log('⏸️ WEBHOOK STANDBY: /api/webhook/uazapi chamado mas desativado');
  console.log('📝 MOTIVO: Evitando duplicidade com webhook principal');
  console.log('🔄 REDIRECIONAMENTO: Use /api/uazapi-webhook-final diretamente');
  
  return res.status(200).json({ 
    success: true, 
    message: 'Webhook em standby - use /api/uazapi-webhook-final',
    timestamp: new Date().toISOString(),
    endpoint: '/api/webhook/uazapi',
    status: 'standby'
  });

  /* CÓDIGO ORIGINAL EM STANDBY - PARA REATIVAR SE NECESSÁRIO:
  
  // Import dinâmico para código funcional (corrige cache Vercel)
  const { default: mainHandler } = await import('../uazapi-webhook-final.js');
  
  // Executar handler V3 funcional
  return mainHandler(req, res);
  
  */
}
