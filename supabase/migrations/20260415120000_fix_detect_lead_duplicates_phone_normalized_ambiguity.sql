-- Fix: renomeia variável local phone_normalized para v_phone_normalized
-- em detect_lead_duplicates para evitar conflito com a coluna leads.phone_normalized
-- Erro: column reference "phone_normalized" is ambiguous

CREATE OR REPLACE FUNCTION detect_lead_duplicates(new_lead_id smallint)
RETURNS TABLE(duplicate_id smallint, reason text)
LANGUAGE plpgsql AS $$
DECLARE
    lead_record RECORD;
    v_phone_normalized TEXT;
BEGIN
    SELECT * INTO lead_record FROM leads WHERE id = new_lead_id;

    IF lead_record.phone IS NOT NULL AND trim(lead_record.phone) != '' THEN
        v_phone_normalized := REGEXP_REPLACE(lead_record.phone, '[^0-9]', '', 'g');

        IF LENGTH(v_phone_normalized) >= 10 THEN
            FOR duplicate_id, reason IN
                SELECT l.id::SMALLINT, 'phone'::TEXT
                FROM leads l
                WHERE REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g') = v_phone_normalized
                  AND l.company_id = lead_record.company_id
                  AND l.id != new_lead_id
                  AND l.deleted_at IS NULL
                  AND l.phone IS NOT NULL
                  AND trim(l.phone) != ''
                LIMIT 1
            LOOP
                RETURN NEXT;
                RETURN;
            END LOOP;
        END IF;
    END IF;

    IF lead_record.email IS NOT NULL AND trim(lead_record.email) != '' THEN
        FOR duplicate_id, reason IN
            SELECT l.id::SMALLINT, 'email'::TEXT
            FROM leads l
            WHERE lower(trim(l.email)) = lower(trim(lead_record.email))
              AND l.company_id = lead_record.company_id
              AND l.id != new_lead_id
              AND l.deleted_at IS NULL
              AND l.email IS NOT NULL
              AND trim(l.email) != ''
            LIMIT 1
        LOOP
            RETURN NEXT;
            RETURN;
        END LOOP;
    END IF;

    RETURN;
END;
$$;
