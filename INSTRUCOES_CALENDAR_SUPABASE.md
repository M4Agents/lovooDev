# 🔧 INSTRUÇÕES PARA CORRIGIR ERRO DO CALENDÁRIO

## 🎯 PROBLEMA IDENTIFICADO

O sistema de Calendário foi implementado no código, mas as tabelas ainda **não existem no banco de dados Supabase**. Por isso, ao tentar criar uma atividade, o sistema retorna erro 400.

## ✅ SOLUÇÃO

Execute o script SQL no Supabase para criar as tabelas necessárias.

---

## 📋 PASSO A PASSO

### **1. Acesse o SQL Editor do Supabase**

Abra o link abaixo no navegador:

```
https://supabase.com/dashboard/project/etzdsywunlpbgxkphuil/sql/new
```

### **2. Cole o Script SQL**

1. Abra o arquivo `EXECUTAR_NO_SUPABASE_CALENDAR.sql` (na raiz do projeto)
2. Copie **TODO** o conteúdo do arquivo
3. Cole no SQL Editor do Supabase

### **3. Execute o Script**

1. Clique no botão **"Run"** (ou pressione `Ctrl+Enter`)
2. Aguarde a execução (pode levar alguns segundos)
3. Verifique se aparece mensagem de sucesso

### **4. Verifique se as Tabelas Foram Criadas**

Execute esta query no SQL Editor para confirmar:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND (table_name LIKE '%calendar%' OR table_name = 'lead_activities')
ORDER BY table_name;
```

**Resultado esperado:**
```
calendar_permissions
calendar_settings
lead_activities
```

---

## 🗄️ TABELAS CRIADAS

### **1. `lead_activities`**
- Atividades agendadas com leads
- Calendário individual por usuário
- Validação: não permite data/hora no passado

### **2. `calendar_permissions`**
- Controle de quem pode ver a agenda de quem
- Níveis: view, edit, manage

### **3. `calendar_settings`**
- Configurações pessoais do calendário
- Visualização padrão, horários, notificações

---

## 🔐 SEGURANÇA

- ✅ RLS (Row Level Security) habilitado em todas as tabelas
- ✅ Políticas de acesso por usuário e empresa
- ✅ Isolamento total entre empresas
- ✅ Permissões validadas no backend

---

## 🧪 TESTE APÓS EXECUÇÃO

1. Acesse o Calendário no sistema
2. Clique em "Nova Atividade"
3. Preencha os campos e salve
4. Verifique se a atividade aparece no calendário

Se tudo funcionar, o erro 400 não aparecerá mais! ✅

---

## ❓ PROBLEMAS?

Se ainda houver erro após executar o script:

1. Verifique se você está logado no Supabase correto (projeto `etzdsywunlpbgxkphuil`)
2. Confirme que as 3 tabelas foram criadas (query acima)
3. Limpe o cache do navegador (Ctrl+Shift+R)
4. Recarregue a página do sistema

---

**Data:** 2026-03-07  
**Versão:** DEV (lovooDev)
