-- =============================================================================
-- Criar bucket de mídia para Instagram Direct Messages
--
-- public = true  : URLs de objetos acessíveis publicamente (necessário para
--                  a Meta API conseguir buscar a mídia ao enviar para o usuário)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'instagram-media',
  'instagram-media',
  true,
  26214400,  -- 25 MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime',
    'audio/ogg', 'audio/mpeg', 'audio/webm'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Política: leitura pública (URL pública para a Meta API)
CREATE POLICY "instagram_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'instagram-media');

-- Política: upload somente para usuários autenticados
CREATE POLICY "instagram_media_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'instagram-media'
    AND auth.uid() IS NOT NULL
  );

-- Política: deleção apenas pelo próprio uploader
CREATE POLICY "instagram_media_auth_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'instagram-media'
    AND owner = auth.uid()
  );
