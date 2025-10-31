# Guia de Deploy - M4 Track

## Pré-requisitos

- Conta no Supabase (gratuita)
- Node.js 18+ instalado
- Git instalado

## 1. Configuração do Supabase

### 1.1 Banco de Dados

✅ **O banco de dados já está configurado!**

As migrações foram aplicadas automaticamente e incluem:
- Todas as tabelas (companies, landing_pages, visitors, behavior_events, conversions, webhook_logs, analytics_cache)
- Row Level Security (RLS) habilitado
- Índices otimizados
- Triggers para updated_at

### 1.2 Edge Functions

✅ **A Edge Function `tracking-api` já está deployada!**

A função está disponível em:
```
https://[seu-projeto].supabase.co/functions/v1/tracking-api
```

Endpoints disponíveis:
- `POST /tracking-api/visitor` - Criar visitante
- `POST /tracking-api/event` - Registrar evento
- `POST /tracking-api/convert` - Registrar conversão

## 2. Deploy do Frontend

### Opção 1: Vercel (Recomendado)

1. **Instale o Vercel CLI:**
```bash
npm i -g vercel
```

2. **Configure o projeto:**
```bash
vercel
```

3. **Configure as variáveis de ambiente na Vercel:**
   - Acesse o dashboard da Vercel
   - Vá em Settings > Environment Variables
   - Adicione:
     - `VITE_SUPABASE_URL`: https://lzruhruedbnlgjmgpekj.supabase.co
     - `VITE_SUPABASE_ANON_KEY`: (sua chave anon)

4. **Deploy:**
```bash
vercel --prod
```

### Opção 2: Netlify

1. **Instale o Netlify CLI:**
```bash
npm i -g netlify-cli
```

2. **Build o projeto:**
```bash
npm run build
```

3. **Deploy:**
```bash
netlify deploy --prod --dir=dist
```

4. **Configure as variáveis de ambiente:**
   - Acesse Netlify Dashboard
   - Vá em Site Settings > Environment Variables
   - Adicione as mesmas variáveis do Vercel

### Opção 3: Deploy Manual (qualquer host)

1. **Build o projeto:**
```bash
npm run build
```

2. **Copie a pasta `dist/` para seu servidor**

3. **Configure o servidor web:**
   - Nginx, Apache, ou qualquer servidor de arquivos estáticos
   - Configure redirecionamento para SPA (todas as rotas para index.html)

**Exemplo Nginx:**
```nginx
server {
    listen 80;
    server_name seu-dominio.com;
    root /var/www/m4track/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache para assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## 3. Configuração do Tracking Script

### 3.1 Hospedar o m4track.js

O arquivo `/public/m4track.js` precisa estar acessível publicamente.

**Opções:**

#### A) Mesmo domínio do frontend
O arquivo já estará em `https://seu-dominio.com/m4track.js`

#### B) CDN separado
1. Faça upload do `m4track.js` para um CDN (Cloudflare, AWS CloudFront, etc)
2. Configure CORS no CDN:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
```

### 3.2 Atualizar URL da API no Script

Edite `/public/m4track.js` linha 22:
```javascript
this.config.apiUrl = apiUrl || 'https://lzruhruedbnlgjmgpekj.supabase.co/functions/v1';
```

## 4. Testar a Instalação

### 4.1 Criar conta
1. Acesse `https://seu-dominio.com`
2. Crie uma conta de teste
3. Verifique se a empresa foi criada no Supabase

### 4.2 Criar Landing Page
1. Acesse "Landing Pages"
2. Crie uma nova landing page
3. Copie o código de tracking

### 4.3 Testar Tracking

Use a landing page de exemplo incluída:
1. Copie `/public/example-landing-page.html` para um servidor local
2. Substitua `SEU-TRACKING-CODE` pelo código real
3. Atualize a `API_URL` para sua URL de produção
4. Abra no navegador e interaja com a página
5. Verifique se os eventos aparecem no dashboard

## 5. Configuração de Domínio Personalizado

### 5.1 Configurar DNS
Aponte seu domínio para o host escolhido:
- **Vercel**: Adicione domínio no dashboard
- **Netlify**: Configure em Domain Settings
- **Servidor próprio**: Configure registros A/CNAME

### 5.2 Configurar SSL
- Vercel e Netlify: SSL automático
- Servidor próprio: Use Let's Encrypt

```bash
# Certbot (Let's Encrypt)
sudo certbot --nginx -d seu-dominio.com
```

## 6. Otimizações de Produção

### 6.1 Cache de Assets
Configure cache para assets estáticos (1 ano):
```
Cache-Control: public, max-age=31536000, immutable
```

### 6.2 Compressão
Habilite Gzip/Brotli no servidor:
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

### 6.3 CDN
Use um CDN global para melhor performance:
- Cloudflare (gratuito)
- AWS CloudFront
- Vercel Edge Network (automático)

## 7. Monitoramento

### 7.1 Logs de Erro
Configure monitoramento de erros:
- Sentry
- LogRocket
- Bugsnag

### 7.2 Analytics
- Supabase Dashboard: Monitore uso do banco
- Vercel Analytics: Performance do frontend
- Edge Function Logs: Erros de API

### 7.3 Uptime Monitoring
Configure alertas:
- UptimeRobot (gratuito)
- Pingdom
- StatusCake

## 8. Backup

### 8.1 Banco de Dados
Supabase faz backup automático, mas você pode:
```bash
# Exportar dados
pg_dump -h db.seu-projeto.supabase.co -U postgres -d postgres > backup.sql
```

### 8.2 Código
Mantenha seu código no Git:
```bash
git push origin main
```

## 9. Atualizações

### 9.1 Frontend
```bash
git pull
npm install
npm run build
vercel --prod
```

### 9.2 Edge Functions
As Edge Functions já estão deployadas. Para atualizar:
1. Modifique o código da função
2. Use as ferramentas MCP para re-deploy

### 9.3 Migrações de Banco
Para novas migrações:
1. Crie o arquivo SQL
2. Use `mcp__supabase__apply_migration`

## 10. Checklist de Deploy

- [ ] Supabase configurado e migrações aplicadas
- [ ] Edge Function `tracking-api` deployada
- [ ] Frontend buildado e deployado
- [ ] Variáveis de ambiente configuradas
- [ ] DNS configurado
- [ ] SSL/HTTPS habilitado
- [ ] Conta de teste criada e funcionando
- [ ] Landing page de exemplo testada
- [ ] Tracking funcionando corretamente
- [ ] Webhooks testados (se aplicável)
- [ ] Monitoramento configurado
- [ ] Backup configurado

## 11. Troubleshooting

### Problema: Tracking não funciona
**Solução:**
1. Verifique o console do navegador
2. Confirme que a API URL está correta
3. Verifique se o tracking_code é válido
4. Teste a Edge Function diretamente:
```bash
curl -X POST https://seu-projeto.supabase.co/functions/v1/tracking-api/visitor \
  -H "Content-Type: application/json" \
  -d '{"tracking_code":"test"}'
```

### Problema: Webhook não envia
**Solução:**
1. Verifique se a URL está configurada em Settings
2. Confirme que a URL é acessível publicamente
3. Verifique os logs em "Webhook Logs"
4. Teste com RequestBin ou webhook.site primeiro

### Problema: RLS bloqueia acesso
**Solução:**
1. Verifique se o usuário está autenticado
2. Confirme que as policies estão corretas
3. Teste no SQL Editor do Supabase:
```sql
SELECT * FROM companies WHERE user_id = auth.uid();
```

### Problema: Edge Function com erro 500
**Solução:**
1. Verifique os logs no Supabase Dashboard
2. Confirme que as variáveis de ambiente estão disponíveis
3. Teste localmente primeiro

## 12. URLs Importantes

Após o deploy, salve estas URLs:

- **Frontend:** https://seu-dominio.com
- **Tracking API:** https://lzruhruedbnlgjmgpekj.supabase.co/functions/v1/tracking-api
- **Tracking Script:** https://seu-dominio.com/m4track.js
- **Supabase Dashboard:** https://app.supabase.com/project/lzruhruedbnlgjmgpekj

## 13. Próximos Passos

Após o deploy bem-sucedido:

1. **Documentação:** Compartilhe o README.md e API_DOCS.md com sua equipe
2. **Treinamento:** Ensine sua equipe a usar o dashboard
3. **Integração:** Configure webhooks para seu CRM/sistema
4. **Landing Pages:** Adicione o tracking às suas landing pages reais
5. **Monitoramento:** Configure alertas e monitore métricas

## Suporte

Para problemas de deploy:
- Consulte os logs do Supabase
- Verifique o README.md
- Revise a API_DOCS.md
- Teste com a landing page de exemplo

---

**Última atualização:** 2025-10-31
**Versão:** 1.0.0
