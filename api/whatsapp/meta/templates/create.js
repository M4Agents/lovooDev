// =============================================================================
// POST /api/whatsapp/meta/templates/create
//
// Submete um template textual (HEADER TEXT + BODY + FOOTER) à Graph API.
// Sem botões, mídia ou AUTHENTICATION nesta fase.
//
// Fluxo:
//   1. Method guard (POST)
//   2. getSupabaseAdmin()
//   3. validateMetaCaller(META_CONNECT_ROLES)
//   4. Validar instance_id
//   5. Lookup instância por auth.companyId
//   6. Exigir status connected
//   7. Credential + decrypt
//   8. buildGraphCreatePayload (campos escalares; ignora waba_id/token do client)
//   9. createMessageTemplate(token do banco, waba_id do banco, payload)
//  10. Resposta { id, name, language, status, category }
// =============================================================================

import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken } from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { createMessageTemplate } from '../../../lib/meta-whatsapp/graphClient.js';
import { buildGraphCreatePayload } from '../../../lib/meta-whatsapp/templateCreate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_MAX_CHARS = 32_768;

function submissionMessage(status) {
  return `Modelo enviado para análise da Meta. Status atual: ${status}. A aprovação não é imediata.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  try {
    const body = req.body ?? {};
    try {
      if (JSON.stringify(body).length > BODY_MAX_CHARS) {
        return res.status(400).json({ error: 'invalid_request' });
      }
    } catch {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const companyId = body.company_id;
    const instanceId = body.instance_id;

    const auth = await validateMetaCaller(req, svc, companyId, { roles: META_CONNECT_ROLES });
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    if (!instanceId || !UUID_RE.test(instanceId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const { data: instance, error: instErr } = await svc
      .from('meta_whatsapp_instances')
      .select('id, waba_id, status')
      .eq('id', instanceId)
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .maybeSingle();

    if (instErr) {
      return res.status(500).json({ error: 'internal_error' });
    }
    if (!instance) {
      return res.status(404).json({ error: 'instance_not_found' });
    }
    if (instance.status !== 'connected') {
      return res.status(409).json({ error: 'instance_not_connected' });
    }

    const { data: credential, error: credErr } = await svc
      .from('meta_whatsapp_credentials')
      .select('access_token_enc')
      .eq('instance_id', instance.id)
      .maybeSingle();

    if (credErr || !credential?.access_token_enc) {
      return res.status(500).json({ error: 'credentials_missing' });
    }

    let plainToken;
    try {
      plainToken = decryptMetaToken(credential.access_token_enc);
    } catch {
      return res.status(500).json({ error: 'credentials_missing' });
    }

    const built = buildGraphCreatePayload({
      name: body.name,
      language: body.language,
      category: body.category,
      header_text: body.header_text,
      body_text: body.body_text,
      footer_text: body.footer_text,
      examples: body.examples,
      buttons: body.buttons,
      components: body.components,
      header_format: body.header_format,
    });

    if (!built.ok) {
      return res.status(400).json({ error: built.error });
    }

    let created;
    try {
      created = await createMessageTemplate(plainToken, instance.waba_id, built.payload);
    } catch (err) {
      const code = err?.code;
      if (code === 'graph_timeout' || code === 'graph_network_error') {
        return res.status(503).json({ error: 'provider_unavailable' });
      }
      return res.status(502).json({ error: 'provider_error' });
    }

    return res.status(200).json({
      id: created.id,
      name: built.payload.name,
      language: built.payload.language,
      status: created.status,
      category: created.category,
      message: submissionMessage(created.status),
    });
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
