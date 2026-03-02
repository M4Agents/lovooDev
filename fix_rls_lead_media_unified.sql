-- =====================================================
-- FIX RLS - LEAD_MEDIA_UNIFIED
-- =====================================================
-- Script para permitir inserções na tabela lead_media_unified
-- Necessário para que o upload direto S3 funcione completamente
-- Data: 2026-02-22 12:54

-- 1. Verificar políticas RLS existentes
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'lead_media_unified';

-- 2. Criar política de INSERT para usuários autenticados
-- Permite que usuários autenticados insiram registros da própria empresa
CREATE POLICY "Usuários podem inserir mídias da própria empresa"
ON lead_media_unified
FOR INSERT
TO authenticated
WITH CHECK (
  -- Verifica se o company_id do registro corresponde ao company_id do usuário
  company_id IN (
    SELECT company_id 
    FROM user_companies 
    WHERE user_id = auth.uid()
  )
);

-- 3. Verificar se a política foi criada
SELECT 
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'lead_media_unified'
  AND cmd = 'INSERT';

-- =====================================================
-- INSTRUÇÕES DE USO
-- =====================================================
-- 1. Acesse: https://supabase.com/dashboard
-- 2. Selecione o projeto
-- 3. Vá em "SQL Editor"
-- 4. Cole este script
-- 5. Execute (Run)
-- 6. Verifique se a política foi criada
-- 7. Teste o upload novamente
-- =====================================================
