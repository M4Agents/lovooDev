// =====================================================
// API: RESUME EXECUTION (shim)
// Objetivo: Validar a requisição e delegar ao engine TypeScript
// O processamento real dos nós ocorre em:
//   src/pages/api/automation/continue-execution.ts
// =====================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  const receivedSecret = req.headers['x-internal-secret'];
  if (!internalSecret || receivedSecret !== internalSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }

  try {
    const { execution_id, user_response } = req.body;

    if (!execution_id || !user_response) {
      return res.status(400).json({
        success: false,
        error: 'execution_id e user_response são obrigatórios'
      });
    }

    if (!UUID_REGEX.test(execution_id)) {
      return res.status(400).json({ success: false, error: 'execution_id inválido' });
    }

    // Delegar ao engine TypeScript via continue-execution (src/pages/api)
    const appBase = process.env.APP_URL || 'https://loovocrm.vercel.app';
    const continueEndpoint = `${appBase}/api/automation/continue-execution`;

    const continueResponse = await fetch(continueEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET || ''
      },
      body: JSON.stringify({ execution_id, user_response })
    });

    if (!continueResponse.ok) {
      const body = await continueResponse.json().catch(() => ({}));
      console.error('❌ resume-execution: engine retornou erro:', continueResponse.status, body);
      return res.status(500).json({ success: false, error: 'Erro ao continuar execução' });
    }

    console.log('✅ resume-execution: execução delegada ao engine:', execution_id);
    return res.status(200).json({ success: true, execution_id });

  } catch (error) {
    console.error('❌ resume-execution: erro inesperado:', error);
    return res.status(500).json({ success: false, error: 'Erro ao retomar execução' });
  }
}
