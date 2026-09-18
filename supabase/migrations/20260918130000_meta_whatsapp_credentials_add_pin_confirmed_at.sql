ALTER TABLE public.meta_whatsapp_credentials
ADD COLUMN registration_pin_confirmed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.meta_whatsapp_credentials.registration_pin_confirmed_at IS
'Instante (UTC) em que uma operação de definição do PIN de registro recebeu confirmação de sucesso da Meta Cloud API. NULL indica que nenhuma confirmação foi registrada pelo Lovoo para este PIN — não implica necessariamente que a Meta não possua um PIN ativo para o número.';
