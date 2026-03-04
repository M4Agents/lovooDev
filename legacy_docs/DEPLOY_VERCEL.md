# 🚀 Deploy Lovoo CRM no Vercel

Este guia explica como fazer o deploy da plataforma Lovoo CRM no Vercel.

## 📋 Pré-requisitos

1. **Conta no Vercel**: [vercel.com](https://vercel.com)
2. **Projeto Supabase**: [supabase.com](https://supabase.com)
3. **Repositório GitHub**: Código já está em `https://github.com/M4Agents/loovocrm.git`

## 🔧 Configuração do Supabase

### 1. Criar/Configurar Projeto Supabase

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard)
2. Crie um novo projeto ou use um existente
3. Execute as migrações SQL (arquivos em `supabase/migrations/`)
4. Anote a URL e chave anon do projeto

### 2. Configurar RLS (Row Level Security)

Execute os scripts SQL presentes na pasta `supabase/migrations/` para configurar:
- Tabelas de empresas, usuários, landing pages
- Políticas de segurança RLS
- Edge Functions (se necessário)

## 🌐 Deploy no Vercel

### 1. Conectar Repositório

1. Acesse [vercel.com/dashboard](https://vercel.com/dashboard)
2. Clique em "New Project"
3. Conecte com GitHub e selecione `M4Agents/loovocrm`
4. Configure as seguintes opções:
   - **Framework Preset**: Vite
   - **Root Directory**: `./`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### 2. Configurar Variáveis de Ambiente

No dashboard do Vercel, vá em **Settings > Environment Variables** e adicione:

```env
VITE_SUPABASE_URL=https://seu-projeto-id.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-aqui
NODE_ENV=production
VITE_APP_NAME=Lovoo CRM
VITE_APP_VERSION=1.0.0
```

### 3. Configurar Domínio (Opcional)

1. No dashboard do Vercel, vá em **Settings > Domains**
2. Adicione seu domínio personalizado
3. Configure os DNS conforme instruções do Vercel

## 🔒 Configurações de Segurança

### Headers de Segurança
O arquivo `vercel.json` já inclui headers de segurança:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`

### CORS para m4track.js
O arquivo JavaScript de tracking já está configurado com CORS adequado para funcionar em qualquer domínio.

## 📊 Monitoramento

### 1. Analytics do Vercel
- Ative o Vercel Analytics no dashboard
- Monitore performance e uso

### 2. Logs do Supabase
- Monitore logs no dashboard do Supabase
- Configure alertas se necessário

## 🧪 Teste Pós-Deploy

### 1. Funcionalidades Básicas
- [ ] Login/cadastro funcionando
- [ ] Dashboard carregando
- [ ] Criação de landing pages
- [ ] Geração de códigos de tracking

### 2. Tracking JavaScript
- [ ] Arquivo `m4track.js` acessível
- [ ] CORS funcionando
- [ ] Tracking de eventos funcionando

### 3. Integração Supabase
- [ ] Conexão com banco de dados
- [ ] Autenticação funcionando
- [ ] RLS aplicado corretamente

## 🔄 Atualizações

Para atualizar o projeto:

1. Faça push das mudanças para o repositório GitHub
2. O Vercel fará deploy automático
3. Verifique os logs de build no dashboard

## 📞 Suporte

Em caso de problemas:

1. Verifique os logs no dashboard do Vercel
2. Confirme as variáveis de ambiente
3. Teste a conexão com Supabase
4. Verifique se as migrações foram executadas

## 🎯 URLs Importantes

- **Dashboard Vercel**: https://vercel.com/dashboard
- **Dashboard Supabase**: https://supabase.com/dashboard
- **Repositório**: https://github.com/M4Agents/loovocrm.git
- **Documentação Vercel**: https://vercel.com/docs
- **Documentação Supabase**: https://supabase.com/docs
