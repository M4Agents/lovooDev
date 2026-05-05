-- Migration: Índices para busca eficiente em lead_import_events.payload_summary
-- Separado da criação da tabela para manter clareza de responsabilidade.
--
-- Estratégia:
--   - GIN com jsonb_path_ops para buscas de containment (@>)
--   - Índice funcional em cada campo textual para ILIKE / LIKE
-- Os dois índices são complementares: GIN para containment exato,
-- funcionais para buscas parciais (ILIKE '%termo%').

-- GIN geral — suporta @> (ex: payload_summary @> '{"email":"foo@bar.com"}')
CREATE INDEX idx_lie_payload_summary_gin
  ON public.lead_import_events USING GIN (payload_summary jsonb_path_ops);

-- Funcionais para ILIKE em cada campo (busca parcial por texto)
CREATE INDEX idx_lie_payload_name
  ON public.lead_import_events ((payload_summary->>'name'));

CREATE INDEX idx_lie_payload_email
  ON public.lead_import_events ((payload_summary->>'email'));

CREATE INDEX idx_lie_payload_phone
  ON public.lead_import_events ((payload_summary->>'phone'));
