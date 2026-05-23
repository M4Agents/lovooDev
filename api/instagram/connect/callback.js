// =============================================================================
// GET /api/instagram/connect/callback
//
// Endpoint TEMPORÁRIO para validação da Redirect URI no Meta Developers.
//
// IMPORTANTE: Este arquivo é um stub mínimo sem lógica real.
// Será substituído pela implementação completa do OAuth na Fase 4
// da integração Instagram conforme o plano técnico.
//
// O que este endpoint FAZ:
//   - Aceita requisições GET
//   - Retorna HTTP 200 com JSON de confirmação
//
// O que este endpoint NÃO FAZ (intencionalmente):
//   - Troca de code por token (OAuth real)
//   - Leitura/validação do state JWT
//   - Qualquer operação no banco de dados
//   - Autenticação de usuário
// =============================================================================

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(200).json({
    ok: true,
    message: 'Instagram callback endpoint active'
  })
}
