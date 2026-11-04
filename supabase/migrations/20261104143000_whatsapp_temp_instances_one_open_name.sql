-- Pacote B. Preparada. Não aplicar neste passo.
-- Impede duas operações abertas com a mesma empresa e o mesmo nome.
-- A igualdade é case-sensitive, como a busca atual por instance_name.
-- Em 2026-11-04 a leitura encontrou 17 grupos duplicados, todos em connecting,
-- distribuídos em 4 empresas. Esta migration não apaga nem altera essas linhas.
-- Se o grupo ainda existir, a criação do índice é interrompida.

DO $$
DECLARE
  duplicated integer;
BEGIN
  SELECT count(*)
    INTO duplicated
  FROM (
    SELECT 1
    FROM public.whatsapp_temp_instances
    WHERE status IN ('creating', 'created', 'created_no_qr', 'connecting')
    GROUP BY company_id, instance_name
    HAVING count(*) > 1
  ) AS open_duplicates;

  IF duplicated > 0 THEN
    RAISE EXCEPTION
      'Pacote B: % grupos com operação aberta duplicada. Índice não criado. Nenhuma linha foi alterada.',
      duplicated;
  END IF;
END $$;

CREATE UNIQUE INDEX whatsapp_temp_instances_one_open_name
  ON public.whatsapp_temp_instances (company_id, instance_name)
  WHERE status IN ('creating', 'created', 'created_no_qr', 'connecting');
