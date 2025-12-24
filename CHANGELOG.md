# 📋 Changelog - Lovoo CRM

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

## [4.0.0] - 2025-12-24 🎯 **SISTEMA DE MÍDIA AWS S3 COMPLETO**

### ✨ Adicionado
- **Sistema AWS S3** completo para mídia WhatsApp (INBOUND + OUTBOUND)
- **Descriptografia WhatsApp** com algoritmo AES-256-CBC + HKDF-SHA256
- **Detecção automática de MediaType** (imagens, vídeos, áudios, documentos)
- **URLs diretas públicas** para melhor performance e compatibilidade
- **Preview de mídia** 100% funcional para todos os tipos
- **Logs detalhados** para debug e monitoramento do sistema
- **Validação de integridade** com hash SHA256 e magic bytes
- **Fallback robusto** para URLs originais em caso de erro

### 🔄 Modificado
- **Webhook final** atualizado com descriptografia WhatsApp completa
- **Frontend chatApi.ts** migrado para AWS S3 direto
- **S3Storage service** implementado com URLs diretas (sem signed URLs)
- **Sistema de mídia** unificado para ambas as direções (INBOUND/OUTBOUND)

### 🛠️ Corrigido
- **Erro expanded.subarray** resolvido com normalização de Buffer
- **MediaType hardcoded** substituído por detecção automática
- **Descriptografia de vídeos** funcionando com info string correta
- **Preview de mídia** exibindo corretamente no chat
- **Arquivos S3** abrindo corretamente no navegador

### 🎯 Benefícios
- **Performance:** Upload/download otimizado via AWS S3
- **Compatibilidade:** URLs diretas funcionam em todos os navegadores
- **Segurança:** Descriptografia local + isolamento por empresa
- **Escalabilidade:** Suporte ilimitado de mídia
- **Confiabilidade:** Sistema robusto com fallbacks

## [1.1.0] - 2025-11-10 🎯 **VERSÃO ESTÁVEL - WEBHOOK AVANÇADO FUNCIONAL**

### ✨ Adicionado
- **Sistema de Webhook Avançado** completo e funcional
- **Interface de configuração** para webhooks personalizados
- **Logs de disparos** com histórico detalhado e filtros
- **Estatísticas em tempo real** (Total, Sucessos, Erros, Últimas 24h)
- **Filtros avançados** por data, status e configuração
- **Seleção de campos** do payload (Lead: name, email, phone, status, origin)
- **Configurações flexíveis** (timeout, retry, headers personalizados)
- **Disparo automático** para eventos lead_created
- **Integração N8N** totalmente funcional
- **Monitoramento robusto** com detecção inteligente de sucessos/erros

### 🔄 Modificado
- **Lógica de sucesso** melhorada (aceita status 2xx, detecta erros reais de rede)
- **Interface de logs** com busca direta na tabela para performance
- **Estrutura do payload** dinâmica baseada em configurações
- **Sistema de filtros** otimizado para queries eficientes

### 🛠️ Corrigido
- **Problema de exibição** dos logs na interface (coluna trigger_event inexistente)
- **Falsos negativos** em webhooks funcionais (status diferentes de 200)
- **Query de logs** adaptada para estrutura real da tabela
- **Filtros de status** baseados em response_status ao invés de success
- **Carregamento inicial** dos logs sem filtros aplicados

### 🗄️ Banco de Dados
- **Tabela webhook_trigger_configs** com payload_fields configurável
- **Tabela webhook_trigger_logs** para histórico completo
- **RPCs otimizadas** para criação, edição e consulta
- **Índices de performance** para queries rápidas
- **Estrutura JSONB** para configurações flexíveis

### 🎨 UI/UX
- **Interface intuitiva** para configuração de webhooks
- **Logs organizados** com status visual claro (✅/❌)
- **Filtros responsivos** com aplicação em tempo real
- **Estatísticas visuais** em cards informativos
- **Feedback imediato** para ações do usuário

### 📊 Funcionalidades Técnicas
- **Disparo automático** via api/webhook-lead.js
- **Payload configurável** com campos selecionáveis
- **Headers personalizados** em formato JSON
- **Retry automático** configurável (1-10 tentativas)
- **Timeout configurável** (5-60 segundos)
- **Logs detalhados** com response completo

### 🎯 Status Atual
- **✅ Webhook disparando** automaticamente para N8N
- **✅ Logs funcionando** com interface completa
- **✅ Filtros operacionais** por data e status
- **✅ Configurações salvas** e carregadas corretamente
- **✅ Sistema estável** e pronto para produção

---

## [1.0.0] - 2025-10-31 🚀

### ✨ Adicionado
- **Rebranding completo** de M4 Track para Lovoo CRM
- **Tela de login moderna** com design elegante e claro
- **Sistema de configuração** para setup inicial do Supabase
- **Deploy otimizado** para Vercel com configurações avançadas
- **Domínio personalizado** https://app.lovoocrm.com/
- **Headers de segurança** completos (XSS, CSRF, Content-Type)
- **Cache inteligente** para assets estáticos
- **Chunks otimizados** para melhor performance
- **Componentes modernos** com TailwindCSS
- **Animações suaves** e transições elegantes

### 🔄 Modificado
- **Nome da aplicação** em todos os arquivos e interfaces
- **SDK JavaScript** de M4Track para LovooCRM
- **Chaves localStorage** com prefixo lovoo_crm_
- **Configuração Vercel** modernizada com rewrites
- **MIME types** configurados corretamente
- **Variáveis de ambiente** padronizadas com VITE_
- **Design system** atualizado para tema claro
- **Tipografia** e espaçamentos refinados

### 🛠️ Corrigido
- **Tela branca** causada por erro de configuração
- **Problemas de CORS** no JavaScript SDK
- **MIME types incorretos** servidos pelo Vercel
- **Conflitos de configuração** entre routes e headers
- **Erros de autenticação** com Supabase
- **Responsividade** em dispositivos móveis
- **Estados de loading** e feedback visual

### 🗑️ Removido
- **Tema escuro** da tela de login
- **Configurações antigas** do Vercel
- **Imports não utilizados** e código morto
- **Referências** ao nome antigo M4 Track
- **Dependências** desnecessárias

### 🔒 Segurança
- **Row Level Security (RLS)** implementado
- **Headers de segurança** configurados
- **Validação de entrada** aprimorada
- **Sanitização** de dados de usuário
- **Tokens JWT** seguros
- **HTTPS** obrigatório em produção

### 📈 Performance
- **Bundle size** otimizado (~435KB → ~120KB gzipped)
- **Build time** reduzido para ~3.5 segundos
- **First Load** < 2 segundos
- **Lazy loading** de componentes
- **Tree shaking** configurado
- **Compressão gzip** habilitada

### 🎨 UI/UX
- **Design system** consistente
- **Paleta de cores** moderna
- **Componentes reutilizáveis** criados
- **Estados de erro** elegantes
- **Feedback visual** aprimorado
- **Acessibilidade** melhorada

---

## [0.9.0] - 2025-10-30

### ✨ Adicionado
- Sistema de autenticação com Supabase
- Dashboard com métricas básicas
- Gestão de landing pages
- Sistema de tracking JavaScript
- Webhooks para conversões
- Interface administrativa

### 🔄 Modificado
- Estrutura do projeto organizada
- Componentes React otimizados
- Integração com banco de dados

---

## Legenda

- ✨ **Adicionado**: Novas funcionalidades
- 🔄 **Modificado**: Mudanças em funcionalidades existentes
- 🛠️ **Corrigido**: Correção de bugs
- 🗑️ **Removido**: Funcionalidades removidas
- 🔒 **Segurança**: Melhorias de segurança
- 📈 **Performance**: Otimizações de performance
- 🎨 **UI/UX**: Melhorias de interface e experiência

---

**Formato baseado em [Keep a Changelog](https://keepachangelog.com/)**
