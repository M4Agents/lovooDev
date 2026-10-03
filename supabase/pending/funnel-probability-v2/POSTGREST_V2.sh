#!/usr/bin/env bash
# Contrato HTTP das RPCs v2 — mesmo caminho do frontend (PostgREST + JWT).
# Sem INSERT/UPDATE/DELETE. Sem service_role. Não imprime JWT, URL completa ou chaves.
# Exit 2 = sessão local ausente (não é falha do contrato).
# Exit 1 = contrato HTTP falhou.

set -euo pipefail

REQUIRED_API_URL='https://etzdsywunlpbgxkphuil.supabase.co'
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SESS_FILE="${AUTH_SESSIONS_FILE:-$ROOT/.cursor-tmp/auth-sessions.json}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pgrst-prob-v2.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

if [[ ! -f "$SESS_FILE" ]]; then
  echo "PENDENTE: sessão autenticada ausente ($SESS_FILE)."
  echo "Grave JWTs localmente a partir do frontend logado. Não cole no chat."
  exit 2
fi

if [[ "${SUPABASE_URL:-}" != "$REQUIRED_API_URL" ]]; then
  echo "ERRO: SUPABASE_URL deve ser exatamente ${REQUIRED_API_URL}." >&2
  exit 1
fi

: "${SUPABASE_ANON_KEY:?}" "${JWT_ADMIN:?}"
: "${COMPANY_ID:?}" "${FUNNEL_ID:?}" "${STAGE_ID:?}"

rpc() {
  local out_base="$1" jwt="$2" name="$3" body="$4"
  local code
  code="$(curl -sS -o "${WORKDIR}/${out_base}.json" -w '%{http_code}' \
    -X POST "${SUPABASE_URL}/rest/v1/rpc/${name}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${jwt}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$body")"
  printf '%s' "$code" > "${WORKDIR}/${out_base}.http"
  echo "${out_base} http=${code} rpc=${name}"
}

body_pos() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import json, os, sys
min_v, max_v = sys.argv[3], sys.argv[4]
def num_or_null(v):
    if v in ("", "null"):
        return None
    return int(v)
print(json.dumps({
    "p_funnel_id": os.environ["FUNNEL_ID"],
    "p_stage_id": os.environ["STAGE_ID"],
    "p_company_id": os.environ["COMPANY_ID"],
    "p_search": None,
    "p_origin": None,
    "p_period_days": None,
    "p_start_date": None,
    "p_end_date": None,
    "p_tag_ids": None,
    "p_tag_mode": "or",
    "p_limit": int(sys.argv[1]),
    "p_offset": int(sys.argv[2]),
    "p_sort_by": None,
    "p_owner_user_id": None,
    "p_unassigned_responsible": False,
    "p_contact_attempts_state": None,
    "p_date_field": "created_at",
    "p_probability_min": num_or_null(min_v),
    "p_probability_max": num_or_null(max_v),
}))
PY
}

body_cnt() {
  python3 - "$1" "$2" <<'PY'
import json, os, sys
def num_or_null(v):
    if v in ("", "null"):
        return None
    return int(v)
print(json.dumps({
    "p_funnel_id": os.environ["FUNNEL_ID"],
    "p_company_id": os.environ["COMPANY_ID"],
    "p_search": None,
    "p_origin": None,
    "p_period_days": None,
    "p_tag_ids": None,
    "p_tag_mode": "or",
    "p_start_date": None,
    "p_end_date": None,
    "p_owner_user_id": None,
    "p_unassigned_responsible": False,
    "p_contact_attempts_state": None,
    "p_date_field": "created_at",
    "p_probability_min": num_or_null(sys.argv[1]),
    "p_probability_max": num_or_null(sys.argv[2]),
}))
PY
}

POS='get_stage_positions_paged_assignee_v2'
CNT='get_funnel_stage_counts_assignee_v2'

rpc pos_norange "$JWT_ADMIN" "$POS" "$(body_pos 20 0 null null)"
rpc pos_50_60 "$JWT_ADMIN" "$POS" "$(body_pos 20 0 50 60)"
rpc pos_page2 "$JWT_ADMIN" "$POS" "$(body_pos 20 20 50 60)"
rpc pos_min_only "$JWT_ADMIN" "$POS" "$(body_pos 20 0 50 null)"
rpc pos_max_only "$JWT_ADMIN" "$POS" "$(body_pos 20 0 null 60)"
rpc pos_invalid "$JWT_ADMIN" "$POS" "$(body_pos 20 0 60 50)"
rpc cnt_norange "$JWT_ADMIN" "$CNT" "$(body_cnt null null)"
rpc cnt_50_60 "$JWT_ADMIN" "$CNT" "$(body_cnt 50 60)"
rpc anon_pos "$SUPABASE_ANON_KEY" "$POS" "$(body_pos 5 0 50 60)"

export WORKDIR STAGE_ID
python3 - <<'PY'
import json, os, sys
from pathlib import Path
wd = Path(os.environ["WORKDIR"])
stage_id = os.environ["STAGE_ID"]
failed = 0

def load(name):
    http = (wd / f"{name}.http").read_text().strip()
    raw = (wd / f"{name}.json").read_text()
    try:
        body = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        body = raw
    return http, body

def fail(msg):
    global failed
    failed += 1
    print(f"FAIL {msg}")

def ok(msg):
    print(f"OK   {msg}")

def require_list(name):
    http, body = load(name)
    if http != "200":
        fail(f"{name}: HTTP={http} esperado 200")
        return []
    if not isinstance(body, list):
        fail(f"{name}: retorno não é array JSON")
        return []
    ok(f"{name}: HTTP 200 array n={len(body)}")
    return body

def require_counts(name):
    http, body = load(name)
    if http != "200" or not isinstance(body, list):
        fail(f"{name}: HTTP={http} retorno counts inválido")
        return None
    row = next((r for r in body if isinstance(r, dict) and r.get("stage_id") == stage_id), None)
    if not row or "count" not in row:
        fail(f"{name}: etapa ausente ou sem count")
        return None
    ok(f"{name}: HTTP 200 count={row.get('count')}")
    return row

pos = require_list("pos_norange")
if pos and not all(isinstance(r, dict) and "id" in r and "opportunity" in r for r in pos[:3] or pos):
    fail("pos_norange: item sem id/opportunity")

require_list("pos_50_60")
page2 = require_list("pos_page2")
ids0 = {r.get("id") for r in require_list("pos_50_60")}
ids1 = {r.get("id") for r in page2}
if ids0 and ids1 and ids0 & ids1:
    fail("paginação 50-60: overlap entre offset 0 e 20")
else:
    ok("paginação 50-60: sem overlap nas duas páginas")

require_list("pos_min_only")
require_list("pos_max_only")
http, body = load("pos_invalid")
code = body.get("code") if isinstance(body, dict) else ""
if http.startswith("4") and code == "22023":
    ok("pos_invalid: HTTP 4xx SQLSTATE 22023")
else:
    fail(f"pos_invalid: HTTP={http} code={code!r} esperado 4xx/22023")

c0 = require_counts("cnt_norange")
c1 = require_counts("cnt_50_60")
if c0 and c1 and int(c1["count"]) > int(c0["count"]):
    fail("count 50-60 maior que sem faixa")

http, _ = load("anon_pos")
if http in {"401", "403"}:
    ok(f"anon_pos: HTTP {http}")
else:
    fail(f"anon_pos: HTTP={http} esperado 401/403")

sys.exit(1 if failed else 0)
PY
