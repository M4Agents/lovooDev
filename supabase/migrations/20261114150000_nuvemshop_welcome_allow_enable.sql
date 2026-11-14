-- NÃO APLICAR até o fluxo real ser aceito e a publicação ser autorizada.
-- Substitui o bloqueio absoluto por uma condição de configuração completa.
-- Não executa UPDATE. Nenhuma campanha existente passa a enabled = true.
-- O consentimento promocional continua opcional.
-- Formato de origem, cupom e textos permanece nos CHECKs já aplicados.

ALTER TABLE public.nuvemshop_welcome_campaigns
  DROP CONSTRAINT chk_nv_welcome_unpublished;

ALTER TABLE public.nuvemshop_welcome_campaigns
  ADD CONSTRAINT chk_nv_welcome_publishable
  CHECK (
    enabled = false
    OR (
      title IS NOT NULL
      AND btrim(title) <> ''
      AND button_label IS NOT NULL
      AND btrim(button_label) <> ''
      AND coupon_code IS NOT NULL
      AND coupon_code ~ '^[A-Z0-9_-]{3,50}$'
      AND consent_text IS NOT NULL
      AND btrim(consent_text) <> ''
      AND consent_version IS NOT NULL
      AND consent_version ~ '^[A-Za-z0-9._-]{1,32}$'
      AND allowed_origins IS NOT NULL
      AND cardinality(allowed_origins) > 0
    )
  );
