#!/usr/bin/env bash
# Carrega sessão local e roda o contrato HTTP das v2.
# Não imprime JWT. Exit 2 se o arquivo de sessões não existir.

set -euo pipefail
REQUIRED_API_URL='https://etzdsywunlpbgxkphuil.supabase.co'
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SESS_FILE="${AUTH_SESSIONS_FILE:-$ROOT/.cursor-tmp/auth-sessions.json}"

if [[ ! -f "$SESS_FILE" ]]; then
  echo "PENDENTE: arquivo de sessões ausente."
  echo "No app local logado (DevTools → Console), sem colar no chat:"
  echo "  const s = (await window.supabase?.auth.getSession())?.data?.session"
  echo "Grave access_token em .cursor-tmp/auth-sessions.json (gitignored)."
  echo "Campos: admin.access_token, company_id, funnel_id, stage_id."
  exit 2
fi

export SUPABASE_URL="$REQUIRED_API_URL"
eval "$(python3 - <<'PY'
from pathlib import Path
p = Path('/Users/leom4/Documents/Projetos/Lovoo-Dev/lovooDev/.env.local')
anon = ''
url = ''
for ln in p.read_text().splitlines():
    if ln.startswith('VITE_SUPABASE_ANON_KEY='):
        anon = ln.split('=', 1)[1].strip().strip('"')
    if ln.startswith('VITE_SUPABASE_URL='):
        url = ln.split('=', 1)[1].strip().strip('"')
if url != 'https://etzdsywunlpbgxkphuil.supabase.co':
    raise SystemExit('SUPABASE_URL do .env.local diverge do projeto')
if not anon:
    raise SystemExit('VITE_SUPABASE_ANON_KEY ausente')
print('export SUPABASE_ANON_KEY=' + repr(anon))
PY
)"

eval "$(python3 - <<PY
import json
from pathlib import Path
d = json.loads(Path("$SESS_FILE").read_text())
admin = d.get("admin") or {}
token = admin.get("access_token") if isinstance(admin, dict) else None
if not token:
    raise SystemExit("admin.access_token ausente")
print("export JWT_ADMIN=" + repr(token))
for src, dest in (
    ("company_id", "COMPANY_ID"),
    ("funnel_id", "FUNNEL_ID"),
    ("stage_id", "STAGE_ID"),
):
    if src not in d or not d[src]:
        raise SystemExit(f"campo {src} ausente")
    print(f"export {dest}=" + repr(d[src]))
PY
)"

exec "$ROOT/supabase/pending/funnel-probability-v2/POSTGREST_V2.sh"
