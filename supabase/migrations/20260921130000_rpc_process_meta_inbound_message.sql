-- =============================================================================
-- Migration: rpc_process_meta_inbound_message
-- Timestamp: 20260921130000
--
-- Objetivo:
--   Criar a RPC public.process_meta_inbound_message para processar
--   atomicamente UMA mensagem inbound TEXT do Meta WhatsApp Cloud API (MVP3A).
--
-- Responsabilidades desta RPC:
--   1. Validar parâmetros obrigatórios.
--   2. Validar que (company_id, instance_id) é uma instância Meta ativa.
--   3. Garantir idempotência por wamid (meta_message_id).
--   4. Criar ou localizar a conversa (meta_conversations).
--   5. Inserir a mensagem (meta_messages).
--   6. Atualizar unread_count, last_message_at e last_message_preview
--      SOMENTE se a mensagem foi realmente inserida.
--
-- Responsabilidades do webhook (fora desta RPC):
--   - Validar assinatura HMAC do webhook Meta.
--   - Resolver metadata.phone_number_id → instance_id + company_id.
--   - Ignorar payloads de grupo (messages[].group_id presente).
--   - Ignorar mensagens com type != 'text'.
--   - Validar campos mínimos antes de invocar esta RPC.
--
-- Autorização:
--   service_role only — REVOKE ALL de PUBLIC, anon, authenticated.
--   Chamada exclusivamente pelo backend Vercel (api/whatsapp/meta/webhook.js).
--   guard interno via auth.role() como defesa em profundidade.
--
-- Idempotência e race condition:
--   - Verificação inicial (etapa 3) retorna early para duplicatas óbvias.
--   - INSERT ON CONFLICT DO NOTHING é a proteção final e autoritativa:
--     dois webhooks concorrentes com o mesmo wamid resultam em apenas um
--     INSERT vencedor; o outro é silenciosamente ignorado.
--   - unread_count é incrementado SOMENTE pelo INSERT vencedor (v_message_id
--     IS NOT NULL), garantindo exatamente um incremento por wamid.
--
-- Regra de timestamp anti-regressão (last_message_at / last_message_preview):
--   - p_provider_timestamp IS NOT NULL: avança somente se >= last_message_at atual.
--     Mensagem atrasada não sobrescreve ordenação/preview de mensagem mais recente.
--   - p_provider_timestamp IS NULL: atualiza somente se last_message_at IS NULL
--     (primeira mensagem), usando now() como fallback operacional.
--     Se last_message_at já é conhecido, preserva ambos sem alteração.
--     meta_messages.provider_timestamp permanece NULL conforme inserido.
--
-- Sem EXCEPTION WHEN OTHERS:
--   Erros de integridade (FK, NOT NULL, CHECK) propagam para o webhook,
--   que deve retornar HTTP 500 para permitir retry da Meta.
--   Duplicata NÃO é erro — retorna created=false com IDs existentes.
--
-- Dependências obrigatórias (devem existir antes de aplicar):
--   20260921100000_create_meta_conversations.sql (M1)
--   20260921110000_alter_meta_conversations_add_company_instance_id_unique.sql (M1.5)
--   20260921120000_create_meta_messages.sql (M2)
--
-- Rollback conceitual:
--   DROP FUNCTION IF EXISTS public.process_meta_inbound_message(
--     UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
--   );
-- =============================================================================

-- =============================================================================
-- FUNÇÃO
-- =============================================================================

-- CREATE FUNCTION (não OR REPLACE) para falhar explicitamente se já existir.
-- Padrão do projeto: rpc_create_meta_whatsapp_connection.
CREATE FUNCTION public.process_meta_inbound_message(
  p_company_id         UUID,
  p_instance_id        UUID,
  p_wa_id              TEXT,
  p_meta_message_id    TEXT,
  p_body               TEXT,
  p_contact_name       TEXT        DEFAULT NULL,
  p_provider_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
  v_message_id      UUID;
BEGIN

  -- ── 0. Barreira: apenas service_role pode chamar esta função ───────────────
  -- Defesa em profundidade: Supabase concede EXECUTE a authenticated via
  -- PostgREST automaticamente em alguns contextos; esta verificação interna
  -- impede chamadas não autorizadas mesmo se os GRANTs externos falharem.
  -- Padrão: process_instagram_dm_webhook.
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 1. Validar parâmetros obrigatórios ────────────────────────────────────
  -- Os tipos UUID garantem NOT NULL estruturalmente.
  -- Para TEXT, verificar também string vazia (inválida no domínio).
  IF p_wa_id IS NULL OR trim(p_wa_id) = '' THEN
    RAISE EXCEPTION 'p_wa_id é obrigatório e não pode ser vazio'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_meta_message_id IS NULL OR trim(p_meta_message_id) = '' THEN
    RAISE EXCEPTION 'p_meta_message_id é obrigatório e não pode ser vazio'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_body IS NULL OR trim(p_body) = '' THEN
    RAISE EXCEPTION 'p_body é obrigatório para message_type=text'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── 2. Validar instância Meta ────────────────────────────────────────────
  -- Verificar que (company_id, instance_id) corresponde a uma instância real
  -- e não removida (soft-delete via deleted_at).
  -- Não confiar apenas na FK de meta_conversations para esta validação:
  -- a FK garante integridade referencial, mas não detecta instâncias deletadas.
  -- Autorização de acesso do usuário deve ocorrer no backend ANTES de invocar.
  IF NOT EXISTS (
    SELECT 1
      FROM public.meta_whatsapp_instances
     WHERE company_id = p_company_id
       AND id         = p_instance_id
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Instância Meta não encontrada ou removida: company_id=%, instance_id=%',
      p_company_id, p_instance_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 3. Idempotência: verificação antecipada de wamid duplicado ───────────
  -- Otimização de desempenho: evita UPSERT conversation desnecessário
  -- para duplicatas óbvias (webhook repetido após 200 perdido, retry da Meta).
  -- NÃO substitui a proteção da UNIQUE(instance_id, meta_message_id) abaixo;
  -- apenas evita trabalho extra no caminho quente de retry.
  SELECT mm.conversation_id,
         mm.id
    INTO v_conversation_id,
         v_message_id
    FROM public.meta_messages mm
   WHERE mm.instance_id     = p_instance_id
     AND mm.meta_message_id = p_meta_message_id;

  IF FOUND THEN
    -- Duplicata confirmada: retornar IDs existentes sem efeitos colaterais.
    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- ── 4. Criar ou localizar a conversa ─────────────────────────────────────
  -- UPSERT por UNIQUE(company_id, instance_id, wa_id).
  -- Nova conversa: inicia com unread_count=0, last_message_at/preview NULL.
  --   Os valores reais serão definidos na etapa 6 (após inserir a mensagem).
  -- Conversa existente (ON CONFLICT):
  --   - contact_name: atualizado SOMENTE se fornecido (COALESCE preserva
  --     o nome existente quando p_contact_name IS NULL).
  --   - unread_count, last_message_at, last_message_preview: NÃO alterados
  --     aqui — apenas o INSERT vencedor (etapa 5+6) incrementa unread.
  --   - O trigger mc_update_updated_at mantém updated_at automaticamente.
  -- Garantia contra race condition: dois webhooks concorrentes fazem UPSERT
  -- na mesma linha por (company_id, instance_id, wa_id) — ambos idempotentes.
  INSERT INTO public.meta_conversations (
    company_id,
    instance_id,
    wa_id,
    contact_name,
    status,
    unread_count,
    last_message_at,
    last_message_preview,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    p_instance_id,
    p_wa_id,
    p_contact_name,
    'active',
    0,
    NULL,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (company_id, instance_id, wa_id) DO UPDATE SET
    -- contact_name: nunca apaga nome existente com NULL.
    contact_name = COALESCE(EXCLUDED.contact_name, meta_conversations.contact_name)
    -- updated_at: mantido pelo trigger mc_update_updated_at (BEFORE UPDATE).
  RETURNING id INTO v_conversation_id;

  -- ── 5. Inserir mensagem ───────────────────────────────────────────────────
  -- direction='inbound' e message_type='text' são definidos internamente:
  -- o caller não decide esses valores em MVP3A.
  --
  -- ON CONFLICT (instance_id, meta_message_id) DO NOTHING:
  --   Proteção final e autoritativa contra wamid duplicado.
  --   Se dois webhooks chegarem concorrentemente com o mesmo wamid:
  --     - Ambos passaram pela verificação antecipada (etapa 3) sem encontrar duplicata.
  --     - Ambos fizeram UPSERT na conversa (idempotente, sem unread).
  --     - O banco garante que apenas UM INSERT vence pela UNIQUE constraint.
  --     - O perdedor obtém v_message_id = NULL → não incrementa unread (etapa 6).
  --   Resultado: exatamente um incremento de unread por wamid. ✅
  INSERT INTO public.meta_messages (
    company_id,
    conversation_id,
    instance_id,
    meta_message_id,
    direction,
    message_type,
    body,
    provider_timestamp,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    v_conversation_id,
    p_instance_id,
    p_meta_message_id,
    'inbound',
    'text',
    p_body,
    p_provider_timestamp,
    now(),
    now()
  )
  ON CONFLICT (instance_id, meta_message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  -- ── 5b. Race condition: recuperar IDs reais da mensagem vencedora ────────
  -- Se DO NOTHING disparou (INSERT perdeu a corrida para webhook concorrente
  -- com o mesmo wamid), v_message_id é NULL.
  -- Recuperamos os IDs reais da mensagem já existente para tornar o retorno
  -- idêntico ao do early check (etapa 3): created=false com IDs concretos.
  -- Retorno antecipado: não incrementa unread, não atualiza stats.
  IF v_message_id IS NULL THEN
    SELECT mm.id,
           mm.conversation_id
      INTO v_message_id,
           v_conversation_id
      FROM public.meta_messages mm
     WHERE mm.instance_id     = p_instance_id
       AND mm.meta_message_id = p_meta_message_id;

    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- ── 6. Atualizar estatísticas da conversa ─────────────────────────────────
  -- Alcançado SOMENTE quando INSERT venceu (v_message_id IS NOT NULL pós-INSERT).
  -- Os caminhos de duplicata (etapa 3 e etapa 5b) retornam antes de chegar aqui.
  -- Garantia de exatamente-uma-vez no incremento de unread. ✅
  --
  -- Regra anti-regressão para last_message_at e last_message_preview:
  --
  -- Caso A — p_provider_timestamp IS NOT NULL:
  --   Avança last_message_at e atualiza preview SOMENTE se:
  --     last_message_at IS NULL (primeira mensagem da conversa)
  --     OU p_provider_timestamp >= last_message_at (mensagem mais recente)
  --   Mensagem atrasada (timestamp antigo) é silenciada: não altera ordenação
  --   nem preview. meta_messages.provider_timestamp permanece com o valor real.
  --
  -- Caso B — p_provider_timestamp IS NULL:
  --   Se last_message_at IS NULL → usar now() como fallback operacional e
  --     atualizar preview (primeira mensagem sem timestamp).
  --   Se last_message_at IS NOT NULL → preservar ambos (last_message_at e
  --     preview existentes). Mensagem sem timestamp não sobrescreve ordenação
  --     de conversa cujo timestamp Meta é conhecido.
  --   meta_messages.provider_timestamp permanece NULL conforme inserido.
  --
  -- preview e last_message_at usam exatamente o mesmo critério:
  --   são atualizados juntos ou nenhum dos dois.
  --   Truncado em 100 caracteres (padrão do projeto).
  --
  -- contact_name:
  --   COALESCE(p_contact_name, contact_name): nunca apaga nome existente.
  --
  -- updated_at: mantido pelo trigger mc_update_updated_at (BEFORE UPDATE).

  UPDATE public.meta_conversations SET
    unread_count         = unread_count + 1,

    last_message_at      = CASE
                             -- Caso A: timestamp conhecido — avança se for mais recente
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN p_provider_timestamp
                             -- Caso B: sem timestamp — fallback now() apenas na 1ª mensagem
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN now()
                             -- Demais casos: preservar valor atual
                             ELSE last_message_at
                           END,

    last_message_preview = CASE
                             -- Caso A: mesma condição de last_message_at
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN LEFT(p_body, 100)
                             -- Caso B: fallback apenas na 1ª mensagem
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN LEFT(p_body, 100)
                             -- Demais casos: preservar preview atual
                             ELSE last_message_preview
                           END,

    contact_name         = COALESCE(p_contact_name, contact_name)
  WHERE id = v_conversation_id;

  -- ── 7. Retorno ─────────────────────────────────────────────────────────────
  -- Alcançado apenas pelo INSERT vencedor (created=true).
  -- Duplicatas retornam antes (etapas 3 e 5b) com created=false.
  -- Sem PII no retorno: body, wa_id, contact_name não são retornados.
  RETURN jsonb_build_object(
    'created',         true,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id
  );

END;
$$;

-- =============================================================================
-- COMMENT
-- =============================================================================

COMMENT ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS
'Processa atomicamente uma mensagem inbound TEXT do Meta WhatsApp Cloud API (MVP3A). '
'Cria ou localiza a conversa (meta_conversations), insere a mensagem (meta_messages) '
'e atualiza unread_count/last_message_at/preview. '
'Idempotente: wamid duplicado retorna created=false com IDs reais (early check ou race recovery). '
'Race condition: ON CONFLICT DO NOTHING + retorno antecipado garantem exatamente um incremento de unread. '
'Timestamp anti-regressão: mensagem sem ts ou atrasada não sobrescreve last_message_at conhecido. '
'Acesso exclusivo de service_role (backend Vercel). '
'Autorização do usuário deve ocorrer ANTES no backend.';

-- =============================================================================
-- GRANTS / REVOKES
-- =============================================================================

-- Assinatura completa obrigatória (padrão do projeto).
-- Previne ambiguidade se overloads futuros forem adicionados.

REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM anon;

REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
