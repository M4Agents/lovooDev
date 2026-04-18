// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/sandbox-audio-run
//
// Recebe áudio gravado pelo usuário no sandbox, transcreve via Whisper e
// executa o agente com o texto transcrito como mensagem do usuário.
// Comportamento idêntico ao sandbox-run, mas com entrada de áudio.
//
// Content-Type: multipart/form-data
// Campos:
//   audio         File   – áudio gravado (ogg, webm, mp4, wav, etc.)
//   company_id    string
//   prompt_config string – JSON serializado
//   agent_name    string (opcional)
//   messages      string – JSON serializado (histórico sem a mensagem de áudio)
//   sandbox_memory string – JSON serializado (opcional)
//   agent_id      string (opcional)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient }        from '@supabase/supabase-js';
import { formidable }          from 'formidable';
import { createReadStream }    from 'fs';
import { unlink }              from 'fs/promises';
import { toFile }              from 'openai';
import { getOpenAIClient }     from '../lib/openai/client.js';
import { executeForSandbox }   from './sandbox-run.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_AUDIO_BYTES  = 10 * 1024 * 1024; // 10 MB
const MAX_MSG_LENGTH   = 2000;
const MAX_HISTORY_TURNS = 15;

const ALLOWED_MIME_PREFIXES = [
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp3',
  'video/ogg',   // alguns browsers enviam audio ogg com mime video/ogg
  'video/webm',  // mesma situação para webm
];

// ── Helpers de autenticação ───────────────────────────────────────────────────

function getAnonSupabase(authHeader) {
  const url  = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anon) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
}

async function validateCaller(authHeader, companyId) {
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }
  const callerClient = getAnonSupabase(String(authHeader));
  if (!callerClient) {
    return { ok: false, status: 503, error: 'Supabase não configurado' };
  }
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }
  const { data: membership } = await callerClient
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();
  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso negado à empresa' };
  }
  return { ok: true };
}

// ── Sanitização de histórico ──────────────────────────────────────────────────

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: String(m.content).trim().slice(0, MAX_MSG_LENGTH) }))
    .filter(m => m.content.length > 0)
    .slice(-(MAX_HISTORY_TURNS * 2));
}

// ── Verificação de MIME type ──────────────────────────────────────────────────

function isAudioMime(mime) {
  if (!mime) return false;
  return ALLOWED_MIME_PREFIXES.some(prefix => String(mime).startsWith(prefix));
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }

  // ── 1. Parse multipart ───────────────────────────────────────────────────────

  let fields, files;
  try {
    const form = formidable({
      maxFileSize:      MAX_AUDIO_BYTES,
      maxFiles:         1,
      keepExtensions:   true,
      maxTotalFileSize: MAX_AUDIO_BYTES,
    });
    [fields, files] = await form.parse(req);
  } catch (err) {
    const isSize = String(err?.message ?? '').toLowerCase().includes('maxfilesize');
    return res.status(isSize ? 413 : 400).json({
      success: false,
      error: isSize ? 'Áudio excede o limite de 10 MB.' : 'Erro ao processar o envio.',
    });
  }

  // ── 2. Extrair e validar campos ──────────────────────────────────────────────

  const fieldStr = (key) => {
    const v = fields[key];
    return Array.isArray(v) ? v[0] : (v ?? '');
  };

  const company_id   = fieldStr('company_id').trim();
  const agent_name   = fieldStr('agent_name').trim();
  const agent_id_raw = fieldStr('agent_id').trim();

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  let prompt_config;
  try {
    prompt_config = JSON.parse(fieldStr('prompt_config'));
  } catch {
    return res.status(400).json({ success: false, error: 'prompt_config inválido.' });
  }

  if (!prompt_config || typeof prompt_config !== 'object') {
    return res.status(400).json({ success: false, error: 'prompt_config inválido.' });
  }
  if (typeof prompt_config.identity !== 'string' || prompt_config.identity.trim().length < 10) {
    return res.status(400).json({ success: false, error: 'prompt_config.identity ausente ou muito curto.' });
  }
  if (typeof prompt_config.objective !== 'string' || prompt_config.objective.trim().length < 10) {
    return res.status(400).json({ success: false, error: 'prompt_config.objective ausente ou muito curto.' });
  }

  let rawMessages = [];
  try {
    rawMessages = JSON.parse(fieldStr('messages'));
  } catch {
    rawMessages = [];
  }

  let sandbox_memory = null;
  try {
    const raw = fieldStr('sandbox_memory');
    if (raw) sandbox_memory = JSON.parse(raw);
  } catch {
    sandbox_memory = null;
  }

  const safeAgentId = agent_id_raw.length > 0 ? agent_id_raw : null;

  // ── 3. Validar arquivo de áudio ──────────────────────────────────────────────

  const audioFile = Array.isArray(files.audio) ? files.audio[0] : files.audio;
  if (!audioFile || !audioFile.filepath) {
    return res.status(400).json({ success: false, error: 'Arquivo de áudio não recebido.' });
  }

  const mimeType = audioFile.mimetype ?? 'audio/ogg';
  if (!isAudioMime(mimeType)) {
    await unlink(audioFile.filepath).catch(() => {});
    return res.status(400).json({ success: false, error: 'Formato de áudio não suportado.' });
  }

  if ((audioFile.size ?? 0) > MAX_AUDIO_BYTES) {
    await unlink(audioFile.filepath).catch(() => {});
    return res.status(413).json({ success: false, error: 'Áudio excede o limite de 10 MB.' });
  }

  // ── 4. Autenticar caller ─────────────────────────────────────────────────────

  const authHeader = req.headers?.authorization;
  const auth = await validateCaller(authHeader, company_id);
  if (!auth.ok) {
    await unlink(audioFile.filepath).catch(() => {});
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── 5. Transcrever áudio via Whisper ─────────────────────────────────────────

  const openaiClient = getOpenAIClient();
  if (!openaiClient) {
    await unlink(audioFile.filepath).catch(() => {});
    return res.status(503).json({ success: false, error: 'Cliente OpenAI não configurado.' });
  }

  let transcript;
  try {
    const originalName = audioFile.originalFilename ?? `audio.${mimeType.split('/').pop() ?? 'ogg'}`;
    const audioStream  = createReadStream(audioFile.filepath);
    const fileForApi   = await toFile(audioStream, originalName, { type: mimeType });

    const transcription = await openaiClient.audio.transcriptions.create({
      file:     fileForApi,
      model:    'whisper-1',
      language: 'pt',
    });
    transcript = (transcription.text ?? '').trim();
  } catch (err) {
    console.error('[SANDBOX-AUDIO] Erro na transcrição:', err?.message ?? err);
    await unlink(audioFile.filepath).catch(() => {});
    return res.status(502).json({ success: false, error: 'Falha na transcrição do áudio. Tente novamente.' });
  } finally {
    await unlink(audioFile.filepath).catch(() => {});
  }

  if (!transcript) {
    return res.status(422).json({ success: false, error: 'Não foi possível reconhecer o áudio. Fale novamente.' });
  }

  // ── 6. Montar histórico com mensagem transcrita ──────────────────────────────

  const sanitizedHistory = sanitizeMessages(rawMessages);
  const sanitizedMessages = [
    ...sanitizedHistory,
    { role: 'user', content: transcript.slice(0, MAX_MSG_LENGTH) },
  ];

  // ── 7. Executar agente no sandbox ────────────────────────────────────────────

  const result = await executeForSandbox({
    company_id,
    prompt_config,
    agent_name,
    sanitizedMessages,
    safeAgentId,
    sandbox_memory,
  });

  return res.status(result.status).json(result.body);
}
