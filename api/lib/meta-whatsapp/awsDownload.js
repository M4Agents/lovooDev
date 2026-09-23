// =============================================================================
// awsDownload.js — Helper backend para download de bytes via AWS S3 (MVP4B.4D.2B)
//
// Responsabilidade: baixar os bytes brutos de um objeto S3 da empresa,
// resolvendo credenciais por-tenant via RPC `webhook_resolve_aws_credentials`.
//
// SEGURANÇA:
//   - Credenciais NUNCA são logadas, nem parcialmente.
//   - Key NUNCA é logada em erro (pode conter path sensível).
//   - svc deve ser um client com service_role (getSupabaseAdmin()).
//   - A validação de prefixo de key (clientes/<company_id>/) é responsabilidade
//     do chamador antes de invocar esta função.
//
// FORA DO ESCOPO DESTA FUNÇÃO:
//   - Validar se a key pertence ao tenant (feito antes pelo chamador).
//   - Detectar MIME ou validar tamanho real (feito depois pelo chamador).
// =============================================================================

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Códigos de erro estruturados para tratamento determinístico pelo chamador.
const ERR_CREDS    = 'aws_credentials_unavailable';
const ERR_NOTFOUND = 'aws_object_not_found';
const ERR_STREAM   = 'aws_stream_error';
const ERR_DOWNLOAD = 'aws_download_failed';

/**
 * Cria um Error com propriedade `code` determinística.
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function makeDownloadError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Baixa os bytes brutos de um objeto S3 usando credenciais por-tenant.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.svc
 *   Client Supabase com service_role. Usado para resolver credenciais via RPC.
 * @param {string} params.companyId
 *   UUID do tenant autenticado. Validado pelo chamador contra auth.companyId.
 * @param {string} params.key
 *   Chave S3 do objeto. Validação de prefixo é responsabilidade do chamador.
 *
 * @returns {Promise<Buffer>}
 *   Buffer com os bytes brutos do objeto.
 *
 * @throws {Error & { code: string }} com codes:
 *   aws_credentials_unavailable — RPC sem resultado ou com erro
 *   aws_object_not_found        — objeto não existe no bucket (NoSuchKey / 404)
 *   aws_stream_error            — erro durante leitura do body stream
 *   aws_download_failed         — qualquer outra falha S3
 */
export async function downloadAwsBytes({ svc, companyId, key }) {
  // ── 1. Resolver credenciais por-tenant ─────────────────────────────────────
  const { data: credsRows, error: credsErr } = await svc
    .rpc('webhook_resolve_aws_credentials', { p_company_id: companyId });

  if (credsErr || !credsRows || credsRows.length === 0) {
    throw makeDownloadError(ERR_CREDS, 'AWS credentials unavailable for tenant');
  }

  const creds = credsRows[0];

  // ── 2. Construir S3Client por-request ──────────────────────────────────────
  // Sem singleton — credenciais são por-tenant e podem variar entre chamadas.
  const client = new S3Client({
    region: creds.region,
    credentials: {
      accessKeyId:     creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
    // SDK v3 default: enviar checksum somente quando necessário para reduzir overhead.
    requestChecksumCalculation:  'WHEN_REQUIRED',
    responseChecksumValidation:  'WHEN_REQUIRED',
  });

  // ── 3. GetObject ────────────────────────────────────────────────────────────
  let response;
  try {
    response = await client.send(
      new GetObjectCommand({ Bucket: creds.bucket, Key: key }),
    );
  } catch (err) {
    const isNotFound =
      err.name === 'NoSuchKey' ||
      err.$metadata?.httpStatusCode === 404;

    throw makeDownloadError(
      isNotFound ? ERR_NOTFOUND : ERR_DOWNLOAD,
      isNotFound ? 'Object not found in S3' : 'S3 GetObject failed',
    );
  }

  if (!response.Body) {
    throw makeDownloadError(ERR_DOWNLOAD, 'S3 response body missing');
  }

  // ── 4. Stream → Buffer ──────────────────────────────────────────────────────
  // Lê o stream completo antes de retornar. O chamador deve ter pré-filtrado
  // file_size via DB antes de invocar esta função para evitar downloads desnecessários.
  try {
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    throw makeDownloadError(ERR_STREAM, 'Error reading S3 response stream');
  }
}
