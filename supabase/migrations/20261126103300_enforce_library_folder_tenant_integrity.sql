BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.lead_media_unified IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.company_folders IN ACCESS EXCLUSIVE MODE;

DO $pre$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.lead_media_unified AS media
    LEFT JOIN public.company_folders AS folder
      ON folder.id = media.folder_id
    WHERE media.folder_id IS NOT NULL
      AND (
        folder.id IS NULL
        OR folder.company_id IS DISTINCT FROM media.company_id
      )
  ) THEN
    RAISE EXCEPTION 'abort: referência de pasta ausente ou entre empresas';
  END IF;
END
$pre$;

ALTER TABLE public.company_folders
  ADD CONSTRAINT company_folders_company_id_id_key
  UNIQUE (company_id, id);

ALTER TABLE public.lead_media_unified
  ADD CONSTRAINT lead_media_unified_company_folder_fkey
  FOREIGN KEY (company_id, folder_id)
  REFERENCES public.company_folders (company_id, id)
  MATCH SIMPLE
  NOT DEFERRABLE;

ALTER TABLE public.lead_media_unified
  DROP CONSTRAINT lead_media_unified_folder_id_fkey;

COMMIT;
