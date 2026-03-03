-- =====================================================
-- FIX RLS SIMPLES - LEAD_MEDIA_UNIFIED
-- =====================================================
-- Versão simplificada para permitir inserções
-- Data: 2026-02-22 13:31

-- 1. DESABILITAR RLS TEMPORARIAMENTE (para testar)
ALTER TABLE lead_media_unified DISABLE ROW LEVEL SECURITY;

-- OU

-- 2. CRIAR POLÍTICA MAIS PERMISSIVA (se preferir manter RLS)
DROP POLICY IF EXISTS "Usuários podem inserir mídias da própria empresa" ON lead_media_unified;

CREATE POLICY "Permitir inserções autenticadas"
ON lead_media_unified
FOR INSERT
TO authenticated
WITH CHECK (true);  -- Permite qualquer inserção de usuários autenticados

-- 3. VERIFICAR POLÍTICAS
SELECT 
  tablename,
  policyname,
  cmd,
  roles,
  with_check
FROM pg_policies
WHERE tablename = 'lead_media_unified';

-- =====================================================
-- ESCOLHA UMA DAS OPÇÕES ACIMA:
-- 
-- OPÇÃO 1 (RECOMENDADA PARA TESTE):
-- Execute apenas: ALTER TABLE lead_media_unified DISABLE ROW LEVEL SECURITY;
-- 
-- OPÇÃO 2 (MAIS SEGURA):
-- Execute os comandos DROP POLICY e CREATE POLICY
-- =====================================================
