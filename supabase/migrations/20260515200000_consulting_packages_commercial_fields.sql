-- =============================================================================
-- Migration: consulting_packages_commercial_fields
-- Timestamp: 20260515200000
--
-- Adiciona campos comerciais opcionais à tabela consulting_packages.
-- Todos os campos são NULL (ou têm DEFAULT) — retrocompatibilidade total.
-- Pacotes existentes sem preenchimento continuam funcionando normalmente.
-- O frontend usa fallbacks quando os campos estão ausentes.
--
-- Campos adicionados:
--   headline     TEXT NULL      — frase de promessa exibida abaixo do nome
--   subheadline  TEXT NULL      — subtítulo complementar (detalhe do card)
--   features     TEXT[] NULL    — lista de benefícios (array de strings)
--   cta_text     TEXT NULL      — texto personalizado do botão de compra
--   badge_text   TEXT NULL      — badge de recomendação (ex: "Mais escolhido")
--   is_highlighted BOOLEAN      — se o card recebe destaque visual
--   display_order  INTEGER      — ordem de exibição na página (ASC)
-- =============================================================================

ALTER TABLE public.consulting_packages
  ADD COLUMN IF NOT EXISTS headline       TEXT     NULL,
  ADD COLUMN IF NOT EXISTS subheadline    TEXT     NULL,
  ADD COLUMN IF NOT EXISTS features       TEXT[]   NULL,
  ADD COLUMN IF NOT EXISTS cta_text       TEXT     NULL,
  ADD COLUMN IF NOT EXISTS badge_text     TEXT     NULL,
  ADD COLUMN IF NOT EXISTS is_highlighted BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order  INTEGER  NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.consulting_packages.headline IS
  'Frase de promessa exibida abaixo do nome no card comercial. '
  'Fallback frontend: usa name quando NULL.';

COMMENT ON COLUMN public.consulting_packages.subheadline IS
  'Subtítulo complementar ao headline. '
  'Fallback frontend: usa description quando NULL.';

COMMENT ON COLUMN public.consulting_packages.features IS
  'Lista de benefícios do pacote como array de strings. '
  'Fallback frontend: exibe description quando NULL. '
  'UI mostra no máximo 5 itens; excedente exibido como "+N benefícios".';

COMMENT ON COLUMN public.consulting_packages.cta_text IS
  'Texto personalizado do botão de compra. '
  'Fallback frontend: "Comprar pacote" quando NULL.';

COMMENT ON COLUMN public.consulting_packages.badge_text IS
  'Badge de recomendação exibido no topo do card (ex: "Mais escolhido"). '
  'NULL = sem badge.';

COMMENT ON COLUMN public.consulting_packages.is_highlighted IS
  'Quando true, o card recebe destaque visual (borda, sombra, fundo diferenciado). '
  'Múltiplos pacotes podem ter is_highlighted=true simultaneamente.';

COMMENT ON COLUMN public.consulting_packages.display_order IS
  'Ordem de exibição dos pacotes na página (ORDER BY display_order ASC). '
  'Valor padrão 0 — pacotes sem ordem definida aparecem antes dos ordenados.';

-- Índice para ordenação eficiente na listagem pública
CREATE INDEX IF NOT EXISTS idx_consulting_packages_display_order
  ON public.consulting_packages (display_order, is_active, is_available_for_sale);
