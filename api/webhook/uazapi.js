// Webhook Uazapi - ENDPOINT CORRETO PARA CONFIGURAÇÃO REAL
// Endpoint: /api/webhook/uazapi
// SOLUÇÃO: Usar nosso código completo com processamento de mídia

export default async function handler(req, res) {
  // Import dinâmico para evitar problemas de path
  const { default: mainHandler } = await import('../uazapi-webhook-final.js');
  
  // Executar nosso handler principal
  return mainHandler(req, res);
}
