-- =============================================================================
-- Meta WhatsApp Cloud API — Fase 1A / Migration 3 de 4
-- Tabela: public.meta_whatsapp_credentials
--
-- Armazena o access_token Meta criptografado (AES-256-GCM).
--
-- Modelo: 1 credential por instância (1:1 com meta_whatsapp_instances).
--   • Token pode ser o mesmo para múltiplos phone_number_ids da mesma WABA,
--     mas é armazenado separadamente por instância (MVP — evita abstração prematura).
--   • company_id é derivado via FK: credentials → instance → company_id.
--     Não duplicar company_id nesta tabela.
--
-- Criptografia (AES-256-GCM, padrão do projeto):
--   • access_token_enc: formato v1:<base64(IV[12] || authTag[16] || ciphertext)>
--   • encryption_version: identifica qual chave ENV foi usada (suporta rotação).
--   • Chave: META_TOKEN_ENC_KEY_V1 (64 hex chars = 32 bytes), somente no backend.
--   • updated_at: registra quando o token foi rotacionado pela última vez.
--
-- Segurança MÁXIMA (nasce protegida):
--   Completamente inacessível para authenticated: RLS ativo + REVOKE ALL.
--   Nem o ciphertext é exposto ao frontend — somente service_role tem acesso.
--
-- Dependência:
--   Requer migration 2 aplicada (meta_whatsapp_instances deve existir para a FK).
--
-- Rollback:
--   DROP TABLE public.meta_whatsapp_credentials;
--   (Remove automaticamente: trigger, PK, FK)
--   EXECUTAR ANTES do rollback de meta_whatsapp_instances (que tem ON DELETE CASCADE aqui).
-- =============================================================================

CREATE TABLE public.meta_whatsapp_credentials (
  -- PK = FK para instância (relação 1:1)
  instance_id         UUID        PRIMARY KEY
                        REFERENCES public.meta_whatsapp_instances(id) ON DELETE CASCADE,

  -- Token Meta criptografado — nunca em plaintext fora do backend
  access_token_enc    TEXT        NOT NULL,

  -- Versão da chave de criptografia (suporte a rotação sem quebrar tokens existentes)
  encryption_version  SMALLINT    NOT NULL DEFAULT 1,

  -- Auditoria: quando o token foi armazenado e quando foi rotacionado
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at — reutiliza update_updated_at_column() existente no projeto.
-- Confirmada em: 20241118_create_plans_management.sql
CREATE TRIGGER trg_mwc_updated_at
  BEFORE UPDATE ON public.meta_whatsapp_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- RLS + GRANT/REVOKE — service_role only
-- =============================================================================
ALTER TABLE public.meta_whatsapp_credentials ENABLE ROW LEVEL SECURITY;

-- Sem CREATE POLICY para authenticated → zero acesso por default RLS.
-- Dupla proteção: RLS ativo sem policies + REVOKE ALL de authenticated.
-- Padrão: lead_conversion_signals (20260718193000), visitor_checkout_links (20260813100000).

REVOKE ALL ON TABLE public.meta_whatsapp_credentials FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_whatsapp_credentials FROM anon;
REVOKE ALL ON TABLE public.meta_whatsapp_credentials FROM authenticated;
GRANT ALL ON TABLE public.meta_whatsapp_credentials TO service_role;
