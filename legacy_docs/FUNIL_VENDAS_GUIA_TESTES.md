# 🧪 GUIA DE TESTES - SISTEMA DE FUNIL DE VENDAS

**Data:** 03/03/2026  
**Versão:** 1.0.0

---

## 📋 CHECKLIST DE TESTES PRÉ-DEPLOY

### ✅ Testes Obrigatórios

#### 1️⃣ TESTE: Acesso à Página
**Objetivo:** Verificar se a página carrega corretamente

**Passos:**
1. Fazer login no sistema
2. Clicar em "Funil de Vendas" no menu lateral
3. Aguardar carregamento

**Resultado Esperado:**
- ✅ Página /sales-funnel carrega sem erros
- ✅ Header com título "Funil de Vendas" visível
- ✅ Dropdown de seleção de funil aparece
- ✅ Botões de ação visíveis (Filtros, Personalizar, Exportar, etc.)

**Critério de Falha:**
- ❌ Erro 404 ou página em branco
- ❌ Erros no console do navegador
- ❌ Loading infinito

---

#### 2️⃣ TESTE: Visualizar Funil Existente
**Objetivo:** Verificar se funil padrão foi criado e tem leads

**Passos:**
1. Na página /sales-funnel
2. Clicar no dropdown de funis
3. Selecionar "Funil Padrão"

**Resultado Esperado:**
- ✅ Dropdown mostra pelo menos 1 funil
- ✅ Ao selecionar, board Kanban aparece
- ✅ Colunas de etapas visíveis
- ✅ Leads aparecem nas colunas (se houver)
- ✅ Estatísticas por etapa visíveis

**Critério de Falha:**
- ❌ Dropdown vazio
- ❌ Board não carrega
- ❌ Erro ao selecionar funil

---

#### 3️⃣ TESTE: Criar Novo Funil
**Objetivo:** Verificar criação de funil

**Passos:**
1. Clicar no dropdown de funis
2. Clicar em "+ Criar Funil"
3. Preencher:
   - Nome: "Funil Teste"
   - Descrição: "Funil para testes"
   - Marcar "Funil ativo"
4. Clicar em "Criar Funil"

**Resultado Esperado:**
- ✅ Modal abre corretamente
- ✅ Campos de formulário funcionam
- ✅ Validação de nome obrigatório funciona
- ✅ Ao criar, modal fecha
- ✅ Novo funil aparece no dropdown
- ✅ Mensagem de sucesso (se implementada)

**Critério de Falha:**
- ❌ Modal não abre
- ❌ Erro ao criar funil
- ❌ Funil não aparece na lista

---

#### 4️⃣ TESTE: Adicionar Lead ao Funil
**Objetivo:** Verificar adição de lead

**Passos:**
1. Selecionar um funil
2. Clicar no ícone "+" em uma coluna
3. Modal abre com lista de leads
4. Buscar por nome de lead
5. Selecionar um lead
6. Clicar em "Adicionar Lead"

**Resultado Esperado:**
- ✅ Modal abre com lista de leads disponíveis
- ✅ Busca filtra leads em tempo real
- ✅ Ao selecionar, lead fica destacado
- ✅ Ao adicionar, modal fecha
- ✅ Lead aparece na coluna selecionada
- ✅ Contador de leads atualiza

**Critério de Falha:**
- ❌ Modal não abre
- ❌ Lista de leads vazia (quando há leads disponíveis)
- ❌ Busca não funciona
- ❌ Lead não aparece após adicionar

---

#### 5️⃣ TESTE: Drag & Drop de Lead
**Objetivo:** Verificar movimentação de lead entre etapas

**Passos:**
1. Selecionar funil com leads
2. Clicar e segurar em um card de lead
3. Arrastar para outra coluna
4. Soltar

**Resultado Esperado:**
- ✅ Card se move visualmente durante drag
- ✅ Overlay aparece durante drag
- ✅ Coluna de destino destaca ao passar mouse
- ✅ Ao soltar, lead muda de coluna
- ✅ Estatísticas atualizam
- ✅ Histórico é registrado (verificar no banco)

**Critério de Falha:**
- ❌ Drag não funciona
- ❌ Lead não muda de coluna
- ❌ Erro no console
- ❌ Lead desaparece

---

#### 6️⃣ TESTE: Editar Etapa
**Objetivo:** Verificar edição de etapa

**Passos:**
1. Clicar no ícone "⋮" em uma coluna (etapa não-sistema)
2. Modal de edição abre
3. Alterar cor da etapa
4. Alterar nome para "Etapa Teste"
5. Clicar em "Salvar"

**Resultado Esperado:**
- ✅ Modal abre com dados da etapa
- ✅ Seletor de cores funciona
- ✅ Paleta de cores rápidas funciona
- ✅ Input de cor hexadecimal funciona
- ✅ Ao salvar, modal fecha
- ✅ Cor da coluna atualiza
- ✅ Nome da etapa atualiza

**Critério de Falha:**
- ❌ Modal não abre
- ❌ Seletor de cores não funciona
- ❌ Alterações não salvam
- ❌ Etapa do sistema pode ser editada

---

#### 7️⃣ TESTE: Personalizar Campos dos Cards
**Objetivo:** Verificar personalização de campos

**Passos:**
1. Clicar em "Personalizar" no header
2. Modal abre com lista de campos
3. Desmarcar "Email" e "Telefone"
4. Clicar em "Salvar Preferências"
5. Recarregar página

**Resultado Esperado:**
- ✅ Modal abre com 11 campos
- ✅ Campos atuais estão marcados
- ✅ Ao desmarcar, contador atualiza
- ✅ Ao salvar, modal fecha
- ✅ Cards atualizam sem email/telefone
- ✅ Após reload, preferências mantidas

**Critério de Falha:**
- ❌ Modal não abre
- ❌ Campos não atualizam
- ❌ Preferências não salvam
- ❌ Após reload, volta ao padrão

---

#### 8️⃣ TESTE: Filtros de Busca
**Objetivo:** Verificar filtros funcionais

**Passos:**
1. Clicar em "Filtros" no header
2. Área de filtros expande
3. Digitar nome de lead no campo "Buscar"
4. Verificar resultados
5. Limpar busca

**Resultado Esperado:**
- ✅ Área de filtros expande/colapsa
- ✅ Ao digitar, leads filtram em tempo real
- ✅ Apenas leads que correspondem aparecem
- ✅ Ao limpar, todos os leads voltam
- ✅ Filtro funciona em todas as colunas

**Critério de Falha:**
- ❌ Filtros não expandem
- ❌ Busca não filtra
- ❌ Leads desaparecem permanentemente

---

#### 9️⃣ TESTE: Exportar Dados
**Objetivo:** Verificar exportação CSV

**Passos:**
1. Selecionar funil com leads
2. Clicar em "Exportar" no header
3. Aguardar download
4. Abrir arquivo CSV no Excel

**Resultado Esperado:**
- ✅ Download inicia automaticamente
- ✅ Arquivo tem nome: `funil_Nome-do-Funil_2026-03-03.csv`
- ✅ Arquivo abre no Excel
- ✅ Headers corretos (Nome, Email, Telefone, etc.)
- ✅ Dados dos leads corretos
- ✅ Caracteres especiais (ç, ã, etc.) aparecem corretamente

**Critério de Falha:**
- ❌ Download não inicia
- ❌ Arquivo vazio
- ❌ Dados incorretos
- ❌ Encoding errado (caracteres estranhos)

---

#### 🔟 TESTE: Click em Lead
**Objetivo:** Verificar navegação ao clicar em lead

**Passos:**
1. Selecionar funil com leads
2. Clicar em um card de lead
3. Verificar redirecionamento

**Resultado Esperado:**
- ✅ Redireciona para /chat
- ✅ Lead correto está selecionado
- ✅ Conversa do lead aparece

**Critério de Falha:**
- ❌ Não redireciona
- ❌ Lead errado selecionado
- ❌ Erro 404

---

### 🔍 Testes de Validação

#### TESTE: Validação de Formulários
**Objetivo:** Verificar validações

**Cenários:**
1. Criar funil sem nome → Deve mostrar erro
2. Criar etapa sem nome → Deve mostrar erro
3. Criar etapa com cor inválida → Deve mostrar erro

---

#### TESTE: Permissões e RLS
**Objetivo:** Verificar isolamento de dados

**Cenários:**
1. Usuário A não deve ver funis da empresa B
2. Usuário A não deve ver leads da empresa B
3. Etapas do sistema não podem ser deletadas

---

#### TESTE: Performance
**Objetivo:** Verificar performance

**Cenários:**
1. Funil com 100+ leads deve carregar em < 2s
2. Drag & drop deve ser fluido
3. Filtros devem responder instantaneamente

---

### 📊 Testes de Dados

#### TESTE: Verificar Migração de Leads
**SQL para executar no Supabase:**

```sql
-- Verificar total de leads migrados
SELECT COUNT(*) as total_leads_no_funil 
FROM lead_funnel_positions;

-- Deve retornar 348 ou mais

-- Verificar distribuição por etapa
SELECT 
  fs.name as etapa,
  COUNT(*) as quantidade_leads
FROM lead_funnel_positions lfp
JOIN funnel_stages fs ON fs.id = lfp.stage_id
GROUP BY fs.name
ORDER BY fs.position;

-- Verificar se todos os leads têm posição
SELECT COUNT(*) as leads_sem_posicao
FROM leads l
WHERE l.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM lead_funnel_positions lfp 
  WHERE lfp.lead_id = l.id
);

-- Deve retornar 0
```

---

#### TESTE: Verificar Histórico
**SQL para executar no Supabase:**

```sql
-- Verificar se histórico está sendo registrado
SELECT 
  l.name as lead,
  fs_from.name as de_etapa,
  fs_to.name as para_etapa,
  lsh.moved_at
FROM lead_stage_history lsh
JOIN leads l ON l.id = lsh.lead_id
JOIN funnel_stages fs_from ON fs_from.id = lsh.from_stage_id
JOIN funnel_stages fs_to ON fs_to.id = lsh.to_stage_id
ORDER BY lsh.moved_at DESC
LIMIT 10;
```

---

### 🐛 Testes de Edge Cases

#### TESTE: Funil Vazio
**Cenário:** Funil sem leads
**Resultado Esperado:** Mensagem "Nenhum lead nesta etapa"

#### TESTE: Lead sem Informações
**Cenário:** Lead sem email, telefone, empresa
**Resultado Esperado:** Card exibe apenas nome

#### TESTE: Muitos Leads
**Cenário:** Etapa com 50+ leads
**Resultado Esperado:** Scroll funciona, performance OK

#### TESTE: Nome Longo
**Cenário:** Lead com nome muito longo
**Resultado Esperado:** Texto truncado com "..."

---

### 📱 Testes de Responsividade

#### Desktop (1920x1080)
- ✅ Board ocupa tela inteira
- ✅ Todas as colunas visíveis
- ✅ Scroll horizontal se necessário

#### Tablet (768x1024)
- ✅ Layout adaptado
- ✅ Colunas menores
- ✅ Botões acessíveis

#### Mobile (375x667)
- ✅ Layout mobile-first
- ✅ Scroll vertical e horizontal
- ✅ Touch drag & drop funciona

---

### 🔒 Testes de Segurança

#### TESTE: RLS (Row Level Security)
**Objetivo:** Verificar isolamento de dados

**Passos:**
1. Login como Empresa A
2. Criar funil "Funil A"
3. Logout
4. Login como Empresa B
5. Acessar /sales-funnel

**Resultado Esperado:**
- ✅ Empresa B não vê "Funil A"
- ✅ Empresa B tem seu próprio funil padrão
- ✅ Dados completamente isolados

---

### ⚡ Testes de Performance

#### TESTE: Tempo de Carregamento
**Métricas:**
- Carregamento inicial: < 2s
- Troca de funil: < 1s
- Drag & drop: < 100ms
- Filtros: instantâneo

#### TESTE: Memória
**Verificar:**
- Sem memory leaks
- Componentes desmontam corretamente
- Event listeners removidos

---

### 📝 Relatório de Testes

#### Template de Relatório

```
TESTE: [Nome do Teste]
DATA: [Data]
TESTADOR: [Nome]
AMBIENTE: [Dev/Prod]

RESULTADO: [✅ Passou / ❌ Falhou]

OBSERVAÇÕES:
- [Observação 1]
- [Observação 2]

BUGS ENCONTRADOS:
- [Bug 1]
- [Bug 2]

SCREENSHOTS:
- [Link para screenshots]
```

---

### ✅ CHECKLIST FINAL DE TESTES

Antes de fazer deploy, confirmar:

- [ ] Todos os 10 testes obrigatórios passaram
- [ ] Validações funcionam corretamente
- [ ] RLS está ativo e funcionando
- [ ] Performance está aceitável
- [ ] Sem erros no console
- [ ] Sem warnings críticos
- [ ] Migrations aplicadas
- [ ] Dados migrados corretamente
- [ ] Preferências salvam e carregam
- [ ] Exportação funciona
- [ ] Histórico está sendo registrado
- [ ] Responsividade OK
- [ ] Segurança verificada

---

## 🎯 CONCLUSÃO

Execute todos os testes acima antes de fazer deploy para produção.

**Critério de Aprovação:**
- ✅ 100% dos testes obrigatórios devem passar
- ✅ 0 erros críticos
- ✅ Performance aceitável
- ✅ Segurança verificada

**Em caso de falha:**
1. Documentar o bug
2. Corrigir o problema
3. Re-executar todos os testes
4. Aprovar apenas quando 100% OK

---

**Boa sorte com os testes! 🚀**
