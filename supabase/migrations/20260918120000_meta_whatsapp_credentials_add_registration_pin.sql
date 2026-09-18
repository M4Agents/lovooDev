ALTER TABLE public.meta_whatsapp_credentials
ADD COLUMN registration_pin_enc TEXT NULL;

COMMENT ON COLUMN public.meta_whatsapp_credentials.registration_pin_enc IS
'PIN de registro do número na Meta WhatsApp Cloud API, armazenado cifrado quando disponível.';
