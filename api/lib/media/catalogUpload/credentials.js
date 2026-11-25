import { CatalogUploadError } from './errors.js'

const BUCKET_RE = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/
const REGION_RE = /^[a-z]{2}(?:-[a-z0-9]+)+$/

function unavailable() {
  throw new CatalogUploadError(500, 'Upload indisponível')
}

function matchesStorageName(value, pattern) {
  return typeof value === 'string'
    && pattern.test(value)
    && !value.includes('..')
    && !value.includes('/')
    && !value.includes('\\')
}

export function isValidStorageBucket(value) {
  return matchesStorageName(value, BUCKET_RE)
}

export function isValidStorageRegion(value) {
  return matchesStorageName(value, REGION_RE)
}

/**
 * Resolve credenciais somente depois da autorização.
 * Usa a RPC existente com o cliente service_role já autenticado no servidor.
 * Não lê chave anon nem variáveis AWS de ambiente.
 */
export async function resolveBackendAwsCredentials(svc, companyId) {
  if (!svc || typeof svc.rpc !== 'function') {
    unavailable()
  }

  let result
  try {
    result = await svc.rpc('webhook_resolve_aws_credentials', {
      p_company_id: companyId,
    })
  } catch {
    unavailable()
  }

  const data = result?.data
  if (result?.error || !Array.isArray(data) || data.length !== 1) {
    unavailable()
  }

  const row = data[0]
  if (
    typeof row?.access_key_id !== 'string'
    || row.access_key_id.length === 0
    || typeof row?.secret_access_key !== 'string'
    || row.secret_access_key.length === 0
    || !isValidStorageBucket(row.bucket)
    || !isValidStorageRegion(row.region)
  ) {
    unavailable()
  }

  // A linha pode trazer a credencial da empresa pai. O company_id dela
  // não substitui o companyId já autorizado na chave do objeto.
  return {
    accessKeyId: row.access_key_id,
    secretAccessKey: row.secret_access_key,
    bucket: row.bucket,
    region: row.region,
  }
}
