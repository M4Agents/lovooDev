# CONFIGURAÇÃO CORS - AWS S3

## Bucket: aws-lovoocrm-media

### PASSO 1: Acessar AWS Console

1. Acesse: https://s3.console.aws.amazon.com/s3/
2. Faça login com suas credenciais AWS
3. Localize o bucket: `aws-lovoocrm-media`
4. Clique no bucket para abrir

### PASSO 2: Configurar CORS

1. Clique na aba **"Permissions"** (Permissões)
2. Role até a seção **"Cross-origin resource sharing (CORS)"**
3. Clique em **"Edit"** (Editar)
4. Cole a configuração abaixo:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "PUT",
            "POST",
            "DELETE",
            "HEAD"
        ],
        "AllowedOrigins": [
            "https://lovoo-dev.vercel.app",
            "https://app.lovoocrm.com",
            "http://localhost:3000",
            "http://localhost:5173"
        ],
        "ExposeHeaders": [
            "ETag",
            "x-amz-server-side-encryption",
            "x-amz-request-id",
            "x-amz-id-2"
        ],
        "MaxAgeSeconds": 3000
    }
]
```

5. Clique em **"Save changes"** (Salvar alterações)

### PASSO 3: Verificar Configuração

Após salvar, você verá a configuração CORS ativa no bucket.

### O QUE ESSA CONFIGURAÇÃO FAZ:

- **AllowedOrigins:** Permite uploads dos domínios do seu sistema
- **AllowedMethods:** Permite GET (download) e PUT (upload)
- **AllowedHeaders:** Permite todos os headers necessários
- **ExposeHeaders:** Expõe headers úteis para o frontend
- **MaxAgeSeconds:** Cache da configuração CORS por 50 minutos

### IMPORTANTE:

⚠️ **Esta configuração é NECESSÁRIA** para que o upload direto do frontend para o S3 funcione.

Sem ela, você receberá erro de CORS no navegador.

### TESTE:

Após configurar, teste fazendo upload de um arquivo pequeno primeiro.
Se funcionar, teste com o vídeo de 20MB.
