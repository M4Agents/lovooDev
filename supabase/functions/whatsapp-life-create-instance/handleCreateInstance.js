// Criação legada de instância. O JWT é validado antes do service_role e da UAZAPI.
// A resposta pública conserva success, instanceId, message e data, sem credenciais.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function handleCreateInstance(req, deps) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const bearer = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(\S+)$/) : null;
  if (!bearer || bearer[1].split('.').length !== 3) {
    return json(401, { success: false, error: 'Não autenticado' });
  }

  let identity;
  try {
    identity = await deps.getUser(authHeader);
  } catch {
    return json(401, { success: false, error: 'Não autenticado' });
  }
  if (!identity?.user?.id) return json(401, { success: false, error: 'Não autenticado' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { success: false, error: 'company_id e instance_name são obrigatórios' });
  }

  const companyId = body?.company_id;
  const instanceName = typeof body?.instance_name === 'string' ? body.instance_name.trim() : '';
  if (!companyId || !instanceName) {
    return json(400, { success: false, error: 'company_id e instance_name são obrigatórios' });
  }

  const access = await deps.authorize(identity.user.id, companyId);
  if (!access?.ok) {
    return json(access?.status || 403, {
      success: false,
      error: access?.error || 'Permissão insuficiente para esta operação',
    });
  }

  return json(403, {
    success: false,
    error: 'Esta operação foi encerrada. Use a conexão por QR Code.',
  });
}
