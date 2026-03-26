# 📁 Pasta de Imagens - Lovoo CRM

## 📂 Estrutura

```
images/
├── emails/          # Imagens para templates de email
│   └── logo.png     # Logo para emails (320px width)
├── app/             # Imagens do aplicativo
└── landing/         # Imagens de landing pages
```

## 📧 Imagens para Emails

### **Logo Principal**
- **Arquivo:** `emails/logo.png`
- **Dimensões:** 320px de largura (exibido em 160px para retina)
- **Formato:** PNG com transparência
- **Tamanho máximo:** 50KB
- **Uso:** Templates de email (Invite, Reset Password, Magic Link)

### **URL de Acesso:**
- **Produção:** `https://app.lovoocrm.com/images/emails/logo.png`
- **Local:** `http://localhost:5173/images/emails/logo.png`

## 🎨 Otimização de Imagens

**Recomendações:**
1. Use PNG para logos (transparência)
2. Use WebP para fotos (menor tamanho)
3. Comprima com TinyPNG ou similar
4. Mantenha < 100KB por imagem

## 📋 Templates de Email que Usam Estas Imagens

1. **Invite User** - Convite para ativar conta
2. **Reset Password** - Redefinir senha
3. **Magic Link** - Link de acesso único

## 🚀 Deploy

Imagens são automaticamente deployadas no Vercel junto com o código.
CDN global garante carregamento rápido em qualquer lugar do mundo.
