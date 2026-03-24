# Scripts de Manutenção

## sync-lead-photos.js

Script para sincronizar fotos de perfil de leads do WhatsApp CDN (URLs temporárias) para Supabase Storage (URLs permanentes).

### Problema que Resolve

URLs de fotos do WhatsApp (pps.whatsapp.net) expiram após alguns dias, fazendo com que leads apareçam sem foto na interface.

### Como Funciona

1. Busca todos os contatos com fotos expiradas (URLs do WhatsApp)
2. Para cada contato:
   - Busca foto atual via API Uazapi
   - Baixa a foto
   - Faz upload para Supabase Storage (bucket: chat-media)
   - Atualiza `chat_contacts.profile_picture_url` com URL permanente

### Uso Manual

```bash
# Executar uma vez
node scripts/sync-lead-photos.js
```

### Uso Agendado (Cron Job)

Para executar automaticamente todos os dias às 3h da manhã, adicione em `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-photos",
      "schedule": "0 3 * * *"
    }
  ]
}
```

E crie o endpoint `/api/cron/sync-photos.js`:

```javascript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { stdout, stderr } = await execAsync('node scripts/sync-lead-photos.js');
    
    res.status(200).json({
      success: true,
      output: stdout,
      errors: stderr || null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
```

### Logs

O script gera logs detalhados:
- 📞 Contato sendo processado
- 📡 Chamadas à API Uazapi
- 📥 Download de fotos
- 📤 Upload para Storage
- 💾 Atualização do banco
- 🎉 Sucesso ou ❌ Erro

### Estatísticas

Ao final, mostra relatório:
- Total de contatos processados
- Sucessos
- Pulados (sem foto no WhatsApp)
- Falhas (com detalhes dos erros)

### Segurança

- ✅ Não modifica webhook funcional
- ✅ Processa em lotes de 100 contatos
- ✅ Delay de 500ms entre requisições
- ✅ Tratamento de erros completo
- ✅ Não quebra se uma foto falhar
