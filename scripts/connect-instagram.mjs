/**
 * Script temporário — conectar conta Instagram manualmente.
 * Uso: node scripts/connect-instagram.mjs SEU_TOKEN_IGAAT...
 *
 * Requer .env.local na raiz do projeto (criado pelo vercel --prod).
 */

import { readFileSync }  from 'fs';
import { createClient }  from '@supabase/supabase-js';
import { createCipheriv, randomBytes } from 'crypto';

// ── Carregar .env.local ────────────────────────────────────────────────────
try {
  const lines = readFileSync('.env.local', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {
  console.error('❌ Arquivo .env.local não encontrado. Rode npx vercel --prod primeiro.');
  process.exit(1);
}

// ── Validar token de entrada ───────────────────────────────────────────────
const rawToken = process.argv[2];
if (!rawToken || !rawToken.startsWith('IGAAT')) {
  console.error('❌ Uso: node scripts/connect-instagram.mjs SEU_TOKEN_IGAAT...');
  process.exit(1);
}

// ── Validar token junto à Meta ─────────────────────────────────────────────
console.log('🔍 Validando token com a Meta...');
const meRes  = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${rawToken}`);
const meData = await meRes.json();

if (meData.error) {
  console.error('❌ Token Meta inválido:', meData.error.message);
  process.exit(1);
}

console.log(`✓ Token válido — conta: @${meData.username} (ID: ${meData.id})`);

// ── Criptografar token (AES-256-GCM) ──────────────────────────────────────
const encKeyHex = process.env.INSTAGRAM_TOKEN_ENC_KEY_V1;
if (!encKeyHex) {
  console.error('❌ INSTAGRAM_TOKEN_ENC_KEY_V1 não encontrado no .env.local');
  process.exit(1);
}

const key   = Buffer.from(encKeyHex, 'hex');
const iv    = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const plaintext = Buffer.from(rawToken, 'utf8');
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const combined = Buffer.concat([iv, tag, encrypted]);
const accessTokenEnc = `v1:${combined.toString('base64')}`;

console.log('✓ Token criptografado');

// ── Verificar expiração via debug_token ────────────────────────────────────
let tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
try {
  const appId     = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (appId && appSecret) {
    const debugRes  = await fetch(`https://graph.facebook.com/debug_token?input_token=${rawToken}&access_token=${appId}|${appSecret}`);
    const debugData = await debugRes.json();
    if (debugData.data?.expires_at) {
      tokenExpiresAt = new Date(debugData.data.expires_at * 1000).toISOString();
      console.log(`✓ Expiração confirmada: ${tokenExpiresAt}`);
    }
  }
} catch { /* não-fatal */ }

// ── Salvar no banco ────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data, error } = await supabase
  .from('instagram_connections')
  .upsert({
    company_id:         'dcc99d3d-9def-4b93-aeb2-1a3be5f15413',
    instagram_user_id:  meData.id,
    instagram_username: meData.username,
    access_token_enc:   accessTokenEnc,
    encryption_version: 1,
    token_expires_at:   tokenExpiresAt,
    scopes:             [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
    ],
    status:          'active',
    status_reason:   null,
    connected_by:    'abe5b85d-5193-404b-a27c-51754dcffce7',
    disconnected_by: null,
    updated_at:      new Date().toISOString(),
  }, {
    onConflict:       'company_id,instagram_user_id',
    ignoreDuplicates: false,
  })
  .select('id, instagram_username, status, token_expires_at')
  .single();

if (error) {
  console.error('❌ Erro ao salvar no banco:', error.message);
  process.exit(1);
}

// ── Audit log ──────────────────────────────────────────────────────────────
await supabase.from('instagram_audit_logs').insert({
  company_id:    'dcc99d3d-9def-4b93-aeb2-1a3be5f15413',
  connection_id: data.id,
  action:        'connect_account_manual',
  performed_by:  'abe5b85d-5193-404b-a27c-51754dcffce7',
  metadata: { instagram_user_id: meData.id, instagram_username: meData.username, source: 'local_script' },
});

console.log('');
console.log('✅ Conta Instagram conectada com sucesso!');
console.log(`   Username : @${data.instagram_username}`);
console.log(`   Status   : ${data.status}`);
console.log(`   Expira   : ${data.token_expires_at}`);
console.log(`   ID       : ${data.id}`);
