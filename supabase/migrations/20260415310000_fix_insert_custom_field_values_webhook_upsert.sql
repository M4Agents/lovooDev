-- MIGRATION: Corrigir insert_custom_field_values_webhook para usar UPSERT
-- Com a nova lógica de não duplicar leads, o mesmo lead_id pode receber campos
-- já existentes na reentrada. O INSERT simples falhava com violação de PK (lead_id, field_id).
-- Solução: ON CONFLICT DO UPDATE para atualizar o valor com a entrada mais recente.

CREATE OR REPLACE FUNCTION insert_custom_field_values_webhook(
  lead_id_param INTEGER,
  field_values  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  result         JSONB := '[]'::JSONB;
  field_value    JSONB;
  inserted_count INTEGER := 0;
BEGIN
  FOR field_value IN SELECT * FROM jsonb_array_elements(field_values)
  LOOP
    INSERT INTO lead_custom_values (lead_id, field_id, value)
    VALUES (
      lead_id_param,
      (field_value->>'field_id')::UUID,
      field_value->>'value'
    )
    ON CONFLICT (lead_id, field_id)
    DO UPDATE SET value = EXCLUDED.value;

    result := result || jsonb_build_object(
      'field_id',      field_value->>'field_id',
      'value',         field_value->>'value',
      'success',       true,
      'error_message', null
    );

    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',        true,
    'inserted_count', inserted_count,
    'values',         result
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',        false,
    'error_message',  SQLERRM,
    'error_code',     SQLSTATE,
    'inserted_count', 0,
    'values',         '[]'::JSONB
  );
END;
$$;
