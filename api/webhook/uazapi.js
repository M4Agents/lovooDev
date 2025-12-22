// Webhook Uazapi - ENDPOINT CORRETO PARA CONFIGURAÇÃO REAL
// Endpoint: /api/webhook/uazapi
// SOLUÇÃO: Redirecionar para código V3 funcional (corrigido 18/12/2025)

export default async function handler(req, res) {
  // Import dinâmico para código funcional (corrige cache Vercel)
  const { default: mainHandler } = await import('../uazapi-webhook-final.js');
  
  // Executar handler V3 funcional
  return mainHandler(req, res);
}
