-- Links promocionais da Nuvemshop.
-- Guarda a definição (nome, código e destino). A URL é montada na cópia.
-- Não altera nuvemshop_connections.store_domain.
-- Aplicar esta migration antes de publicar o código que lê a tabela.
-- Sem a tabela, o painel responde recurso indisponível e não grava outro recurso por cima.
-- A decodificação abaixo tem o mesmo limite da API (5 camadas).

CREATE OR REPLACE FUNCTION public.nuvemshop_promo_percent_decode(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i integer := 1;
  n integer;
  ch text;
  hex text;
  buf bytea := ''::bytea;
  result text := '';
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;
  n := char_length(p_raw);
  WHILE i <= n LOOP
    ch := substr(p_raw, i, 1);
    IF ch = '%' THEN
      IF i + 2 > n THEN
        RETURN NULL;
      END IF;
      hex := substr(p_raw, i + 1, 2);
      IF hex !~ '^[0-9A-Fa-f]{2}$' THEN
        RETURN NULL;
      END IF;
      buf := buf || decode(hex, 'hex');
      i := i + 3;
    ELSE
      IF octet_length(buf) > 0 THEN
        result := result || convert_from(buf, 'UTF8');
        buf := ''::bytea;
      END IF;
      result := result || ch;
      i := i + 1;
    END IF;
  END LOOP;
  IF octet_length(buf) > 0 THEN
    result := result || convert_from(buf, 'UTF8');
  END IF;
  RETURN result;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_promo_destination_safe(p_path text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  current text := p_path;
  nxt text;
  round integer := 0;
BEGIN
  IF current IS NULL OR char_length(current) < 1 OR char_length(current) > 200 THEN
    RETURN false;
  END IF;
  IF left(current, 1) <> '/' THEN
    RETURN false;
  END IF;
  WHILE round < 5 AND position('%' in current) > 0 LOOP
    IF current ~ '%([^0-9A-Fa-f]|$)' THEN
      RETURN false;
    END IF;
    IF position(chr(92) in current) > 0 OR position('//' in current) > 0 OR current ~ '(^|/)\.\.(/|$)'
       OR position('?' in current) > 0 OR position('#' in current) > 0 OR position('*' in current) > 0 THEN
      RETURN false;
    END IF;
    nxt := public.nuvemshop_promo_percent_decode(current);
    IF nxt IS NULL OR nxt = current OR char_length(nxt) > 200 THEN
      RETURN false;
    END IF;
    current := nxt;
    round := round + 1;
  END LOOP;
  IF position('%' in current) > 0 OR position(chr(92) in current) > 0 OR position('//' in current) > 0
     OR position('?' in current) > 0 OR position('#' in current) > 0 OR position('*' in current) > 0
     OR current ~ '(^|/)\.\.(/|$)' OR left(current, 1) <> '/' OR char_length(current) > 200 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.nuvemshop_promo_percent_decode(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nuvemshop_promo_destination_safe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nuvemshop_promo_percent_decode(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_promo_destination_safe(text) TO service_role;
-- O schema public concede EXECUTE por padrão a anon e authenticated.
-- A revogação abaixo mantém estas funções só para service_role.
REVOKE ALL ON FUNCTION public.nuvemshop_promo_percent_decode(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_promo_destination_safe(text) FROM anon, authenticated;

-- Leitura direta: a mesma matriz da API.
-- Seller fica de fora. Partner só com atribuição ativa na mesma empresa pai.
CREATE OR REPLACE FUNCTION public.nuvemshop_promo_partner_can_read(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_users cu
    JOIN public.companies parent_co ON parent_co.id = cu.company_id
    JOIN public.partner_company_assignments pca ON pca.partner_user_id = cu.user_id
    JOIN public.companies target_co ON target_co.id = pca.company_id
    WHERE cu.user_id = auth.uid()
      AND cu.is_active = true
      AND cu.role = 'partner'
      AND parent_co.company_type = 'parent'
      AND pca.company_id = p_company_id
      AND pca.is_active = true
      AND target_co.parent_company_id = cu.company_id
  );
$$;

REVOKE ALL ON FUNCTION public.nuvemshop_promo_partner_can_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nuvemshop_promo_partner_can_read(uuid) TO authenticated;
-- O padrão do schema também concede EXECUTE a anon e service_role.
REVOKE ALL ON FUNCTION public.nuvemshop_promo_partner_can_read(uuid) FROM anon, service_role;

DO $$
DECLARE
  v_owner oid;
BEGIN
  SELECT proowner INTO v_owner
  FROM pg_proc
  WHERE oid = 'public.nuvemshop_promo_percent_decode(text)'::regprocedure;
  IF v_owner IS DISTINCT FROM 'postgres'::regrole THEN
    REVOKE ALL ON FUNCTION public.nuvemshop_promo_percent_decode(text) FROM postgres;
    REVOKE ALL ON FUNCTION public.nuvemshop_promo_destination_safe(text) FROM postgres;
    REVOKE ALL ON FUNCTION public.nuvemshop_promo_partner_can_read(uuid) FROM postgres;
  END IF;
END $$;

CREATE TABLE public.nuvemshop_promo_links (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nuvemshop_store_id   TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  coupon_code          TEXT        NOT NULL,
  coupon_type          TEXT        NOT NULL,
  destination_path     TEXT        NOT NULL,
  created_by           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_nv_promo_link_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT chk_nv_promo_link_code CHECK (coupon_code ~ '^[A-Z0-9_-]{3,50}$'),
  CONSTRAINT chk_nv_promo_link_type CHECK (coupon_type IN ('percentage', 'absolute', 'shipping')),
  CONSTRAINT chk_nv_promo_link_destination CHECK (
    public.nuvemshop_promo_destination_safe(destination_path)
  )
);

CREATE UNIQUE INDEX uq_nv_promo_link_name
  ON public.nuvemshop_promo_links (company_id, nuvemshop_store_id, lower(name));

CREATE INDEX idx_nv_promo_links_store
  ON public.nuvemshop_promo_links (company_id, nuvemshop_store_id, created_at DESC);

CREATE TRIGGER update_nuvemshop_promo_links_updated_at
  BEFORE UPDATE ON public.nuvemshop_promo_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.nuvemshop_promo_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nuvemshop_promo_links FROM PUBLIC;
REVOKE ALL ON TABLE public.nuvemshop_promo_links FROM anon;
REVOKE ALL ON TABLE public.nuvemshop_promo_links FROM authenticated;

GRANT SELECT ON TABLE public.nuvemshop_promo_links TO authenticated;
GRANT ALL ON TABLE public.nuvemshop_promo_links TO service_role;

CREATE POLICY "nv_promo_links_select_member"
  ON public.nuvemshop_promo_links
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND cu.company_id = nuvemshop_promo_links.company_id
        AND cu.is_active = true
        AND cu.role IN ('super_admin', 'system_admin', 'admin', 'manager')
    )
    OR public.nuvemshop_promo_partner_can_read(company_id)
  );

-- INSERT / UPDATE / DELETE: sem policy.
-- O backend grava com service_role depois de validar JWT, papel e conexão ativa.
