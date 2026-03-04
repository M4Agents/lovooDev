# 📞 BASE DE CONHECIMENTO - SUPORTE WHATSAPP INTEGRATION

## 🎯 **GUIA PARA EQUIPE DE SUPORTE**

Este documento contém **todas as informações necessárias** para a equipe de suporte atender usuários sobre a funcionalidade WhatsApp Integration do LovoCRM.

---

## 📱 **VISÃO GERAL DA FUNCIONALIDADE**

### **O QUE É O WHATSAPP INTEGRATION?**
O WhatsApp Integration permite que empresas conectem suas contas do WhatsApp Business ao LovoCRM para:
- **Conectar instâncias** WhatsApp Business via QR Code
- **Gerenciar múltiplas instâncias** de WhatsApp por empresa
- **Chat completo** com interface profissional 3 colunas
- **Enviar e receber mensagens** em tempo real
- **Agendar mensagens** com data e hora específica
- **Gerenciar leads** com informações detalhadas
- **Atribuir conversas** para usuários específicos
- **Acompanhar histórico** completo de conversas

### **VERSÃO ATUAL**
- **Versão**: 2.1.0 (Chat Completo + Webhook Automático + Deleção UAZAPI)
- **Data de Lançamento**: 03 de Março de 2026
- **Status**: ✅ Totalmente Funcional
- **URL**: https://app.lovoocrm.com/
- **Novidades V2.1.0**: 
  - ✅ Configuração automática de webhook UAZAPI
  - ✅ Deleção de instâncias na UAZAPI
  - ✅ Sistema de Chat WhatsApp Completo

---

## 🚀 **FUNCIONALIDADES DISPONÍVEIS**

### **✅ 1. CONECTAR NOVA INSTÂNCIA WHATSAPP**
**Como funciona:**
1. Cliente clica em "Conectar WhatsApp"
2. Sistema gera QR Code automaticamente
3. Cliente escaneia com WhatsApp Business
4. Conexão é detectada automaticamente
5. **NOVO V2.1.0**: Sistema configura webhook automaticamente na UAZAPI
6. Instância aparece na lista como "Conectada"

**Tempo esperado:** 30 segundos a 3 minutos

**🆕 CONFIGURAÇÃO AUTOMÁTICA DE WEBHOOK (V2.1.0)**
- **Automático**: Sistema configura webhook sem intervenção manual
- **URL Dinâmica**: Usa URL de produção configurada no sistema
- **Eventos Completos**: connection, history, messages, messages_update, call, contacts
- **Status**: Webhook habilitado automaticamente
- **Transparente**: Cliente não precisa fazer nada, tudo é automático

### **✅ 2. VISUALIZAR INSTÂNCIAS CONECTADAS**
**Informações exibidas:**
- Nome da instância
- Número do telefone conectado
- Status (Conectado/Desconectado)
- Data e hora da conexão (horário de São Paulo)

### **✅ 3. ALTERAR NOME DA INSTÂNCIA**
**Como funciona:**
1. Cliente clica no botão "Alterar"
2. Digite o novo nome
3. Sistema valida e salva
4. Nome é atualizado imediatamente

### **✅ 4. EXCLUIR INSTÂNCIA**
**Como funciona:**
1. Cliente clica no botão "Excluir"
2. Sistema pede confirmação
3. **NOVO V2.1.0**: Sistema remove instância da UAZAPI automaticamente
4. Instância é removida do banco de dados local
5. Lista é atualizada automaticamente

**⚠️ IMPORTANTE:** A exclusão é permanente e não pode ser desfeita.

**🆕 DELEÇÃO AUTOMÁTICA NA UAZAPI (V2.1.0)**
- **Deleção Completa**: Remove instância tanto do sistema quanto da UAZAPI
- **Desconexão Automática**: Dispositivo é desconectado do WhatsApp
- **Sem Instâncias Órfãs**: Não deixa instâncias abandonadas na UAZAPI
- **Segurança**: Sempre remove do banco local, mesmo se UAZAPI falhar
- **Logs Detalhados**: Sistema registra todo o processo para debug

### **✅ 5. SISTEMA DE CHAT WHATSAPP (NOVO)**
**Como acessar:**
1. Cliente clica em "Chat" no menu lateral
2. Sistema carrega automaticamente as instâncias conectadas
3. Interface 3 colunas é exibida

**Funcionalidades do Chat:**

#### **📋 GERENCIAR CONVERSAS**
- **Filtros disponíveis:**
  - "Todas as Conversas" - Todas as mensagens da empresa
  - "Atribuídas" - Conversas atribuídas ao usuário logado
  - "Não Atribuídas" - Conversas sem responsável
- **Busca em tempo real** por nome, telefone ou conteúdo
- **Ordenação automática** por mensagem mais recente
- **Seletor de instância** (se múltiplas conectadas)

#### **💬 ENVIAR E RECEBER MENSAGENS**
- **Envio instantâneo** de mensagens de texto
- **Status visual** das mensagens (enviado/entregue/lido/falhou)
- **Histórico completo** de conversas
- **Auto-scroll** para mensagens mais recentes
- **Timestamps** formatados em português

#### **⏰ AGENDAR MENSAGENS**
- **Agendar por data/hora** específica
- **Interface intuitiva** com calendário
- **Lista de agendamentos** com status
- **Cancelar agendamentos** pendentes
- **Envio automático** pelo sistema

#### **👤 GERENCIAR LEADS**
- **Informações detalhadas** do contato
- **Status do lead** (Novo, Contatado, Qualificado, Proposta, Negociação, Fechado, Perdido)
- **Valor do negócio** em reais
- **Anotações personalizadas**
- **Estatísticas** (total mensagens, dias de relacionamento)
- **Edição inline** de todas as informações

#### **👥 SISTEMA DE ATRIBUIÇÕES**
- **Atribuir conversas** a usuários específicos
- **Filtro "Atribuídas"** mostra apenas conversas do usuário
- **Indicadores visuais** de conversas atribuídas
- **Controle de acesso** por empresa

**Tempo esperado para carregamento:** 2-5 segundos

---

## 🆘 **PROBLEMAS COMUNS E SOLUÇÕES**

### **❓ PROBLEMA: QR Code não aparece**
**Possíveis causas:**
- Conexão com internet instável
- Servidor temporariamente sobrecarregado

**Soluções:**
1. Aguardar 30 segundos e tentar novamente
2. Atualizar a página (F5)
3. Verificar conexão com internet
4. Se persistir, aguardar 5 minutos e tentar novamente

### **❓ PROBLEMA: QR Code não conecta**
**Possíveis causas:**
- QR Code expirado (expira em 3 minutos)
- WhatsApp não é Business
- Número já conectado em outro lugar

**Soluções:**
1. Gerar novo QR Code
2. Verificar se está usando WhatsApp Business
3. Desconectar de outros dispositivos/sistemas
4. Aguardar 5 minutos e tentar novamente

### **❓ PROBLEMA: Instância aparece como "Desconectada"**
**Possíveis causas:**
- WhatsApp foi desconectado no celular
- Número foi alterado
- Problemas temporários de sincronização
- Webhook não configurado corretamente (corrigido na V2.1.0)

**Soluções:**
1. Verificar se WhatsApp está ativo no celular
2. Reconectar escaneando novo QR Code (webhook será configurado automaticamente)
3. Se necessário, excluir e criar nova instância
4. **NOVO V2.1.0**: Sistema agora configura webhook automaticamente, reduzindo problemas de conexão

### **❓ PROBLEMA: Horário incorreto**
**Solução:**
- Sistema já corrigido para horário de São Paulo
- Se ainda aparecer horário errado, orientar cliente a atualizar página

### **❓ PROBLEMA: Botão "Excluir" não funciona**
**Solução:**
- Problema já corrigido na versão 1.0.0
- Se persistir, orientar cliente a atualizar página (Ctrl+F5)

### **❓ PROBLEMA: Lista de instâncias não atualiza**
**Soluções:**
1. Atualizar página (F5)
2. Aguardar 30 segundos para sincronização automática
3. Fazer logout e login novamente

### **❓ PROBLEMA: Chat não carrega ou aparece vazio**
**Possíveis causas:**
- Nenhuma instância WhatsApp conectada
- Problemas de conexão com internet
- Cache do navegador desatualizado

**Soluções:**
1. Verificar se há instâncias conectadas em Configurações > WhatsApp
2. Conectar pelo menos uma instância WhatsApp
3. Atualizar página (Ctrl+F5) para limpar cache
4. Verificar conexão com internet

### **❓ PROBLEMA: Mensagens não aparecem no chat**
**Possíveis causas:**
- Conversa não foi criada ainda
- Filtro ativo (Atribuídas/Não Atribuídas)
- Instância selecionada incorreta

**Soluções:**
1. Verificar filtro ativo (usar "Todas as Conversas")
2. Verificar se instância correta está selecionada
3. Criar nova conversa manualmente se necessário
4. Aguardar sincronização (até 30 segundos)

### **❓ PROBLEMA: Não consegue enviar mensagem**
**Possíveis causas:**
- Instância WhatsApp desconectada
- Campo de mensagem vazio
- Problemas temporários de conexão

**Soluções:**
1. Verificar se instância está "Conectada" em Configurações
2. Verificar se digitou texto na mensagem
3. Tentar reconectar instância se necessário
4. Aguardar alguns segundos e tentar novamente

### **❓ PROBLEMA: Agendamento de mensagem não funciona**
**Possíveis causas:**
- Data/hora no passado
- Campos obrigatórios não preenchidos
- Instância desconectada

**Soluções:**
1. Verificar se data/hora é futura
2. Preencher todos os campos obrigatórios
3. Verificar se instância está conectada
4. Tentar agendar novamente

### **❓ PROBLEMA: Informações do lead não salvam**
**Possíveis causas:**
- Não clicou em "Salvar" após editar
- Conexão instável durante salvamento
- Campos com formato incorreto

**Soluções:**
1. Sempre clicar em "Salvar" após editar
2. Verificar conexão com internet
3. Verificar formato de e-mail e telefone
4. Tentar salvar novamente

---

## 🔧 **PROCEDIMENTOS DE SUPORTE**

### **📞 ATENDIMENTO NÍVEL 1 (BÁSICO)**
**Problemas que o suporte pode resolver:**
- Orientar sobre como conectar WhatsApp
- Explicar como alterar nome de instância
- Orientar sobre exclusão de instâncias
- Resolver problemas de QR Code
- Orientar sobre atualização de página
- **Explicar como acessar o Chat** (menu lateral)
- **Orientar sobre filtros** de conversa (Todas/Atribuídas/Não Atribuídas)
- **Explicar como enviar mensagens** no chat
- **Orientar sobre agendamento** de mensagens
- **Explicar como editar informações** do lead
- **Resolver problemas básicos** do chat (carregamento, filtros)
- **Orientar sobre busca** de conversas

### **📞 ATENDIMENTO NÍVEL 2 (TÉCNICO)**
**Quando escalar para nível 2:**
- QR Code não aparece após 10 minutos
- Instâncias não sincronizam após várias tentativas
- Erros técnicos persistentes
- Problemas que afetam múltiplos usuários
- **Chat não carrega** após várias tentativas
- **Mensagens não sincronizam** entre dispositivos
- **Agendamentos não executam** no horário correto
- **Problemas de performance** no chat

### **📞 ATENDIMENTO NÍVEL 3 (DESENVOLVIMENTO)**
**Quando escalar para desenvolvimento:**
- Bugs no sistema
- Problemas de integração com Uazapi
- Erros de banco de dados
- Problemas de deploy/produção
- **Falhas no sistema de chat** que afetam múltiplos usuários
- **Problemas de sincronização** entre chat e instâncias
- **Erros de agendamento** em massa
- **Problemas de performance** críticos

---

## 📋 **SCRIPTS DE ATENDIMENTO**

### **🎯 SCRIPT: COMO CONECTAR WHATSAPP**
```
"Olá! Vou te ajudar a conectar seu WhatsApp ao LovoCRM.

1. Acesse a área de WhatsApp no sistema
2. Clique no botão 'Conectar WhatsApp'
3. Aguarde o QR Code aparecer (pode levar até 1 minuto)
4. Abra seu WhatsApp Business no celular
5. Vá em Configurações > Dispositivos Conectados
6. Toque em 'Conectar Dispositivo'
7. Escaneie o QR Code que aparece na tela
8. Aguarde a confirmação de conexão

O processo todo leva cerca de 2-3 minutos. Alguma dúvida?"
```

### **🎯 SCRIPT: QR CODE NÃO APARECE**
```
"Entendo que o QR Code não está aparecendo. Vamos resolver isso:

1. Primeiro, aguarde mais 30 segundos - às vezes demora um pouco
2. Se não aparecer, atualize a página (tecla F5)
3. Tente novamente clicando em 'Conectar WhatsApp'
4. Verifique se sua internet está estável

Se ainda não funcionar, pode ser sobrecarga temporária do servidor. 
Aguarde 5 minutos e tente novamente. Posso acompanhar com você?"
```

### **🎯 SCRIPT: INSTÂNCIA DESCONECTADA**
```
"Vi que sua instância está aparecendo como desconectada. Isso pode acontecer por alguns motivos:

1. Verifique se o WhatsApp Business está funcionando no seu celular
2. Confirme se não desconectou de outros dispositivos recentemente
3. Se necessário, podemos reconectar gerando um novo QR Code

Quer que eu te oriente a reconectar agora mesmo?"
```

### **🎯 SCRIPT: COMO USAR O CHAT (NOVO)**
```
"Ótimo! Vou te explicar como usar o novo sistema de Chat do WhatsApp:

1. Clique em 'Chat' no menu lateral esquerdo
2. O sistema vai carregar suas instâncias WhatsApp automaticamente
3. Na tela você verá 3 colunas:
   - Esquerda: Lista de conversas com filtros
   - Centro: Área para enviar/receber mensagens
   - Direita: Informações do lead e agendamentos

4. Use os filtros: 'Todas', 'Atribuídas' ou 'Não Atribuídas'
5. Clique em uma conversa para abrir o chat
6. Digite e envie mensagens normalmente

Precisa de ajuda com alguma parte específica?"
```

### **🎯 SCRIPT: COMO AGENDAR MENSAGEM**
```
"Vou te ensinar a agendar mensagens no WhatsApp:

1. Abra uma conversa no Chat
2. No painel direito, clique na aba 'Agendar'
3. Clique em 'Agendar Mensagem'
4. Preencha:
   - Mensagem que quer enviar
   - Data (deve ser futura)
   - Horário desejado
5. Clique em 'Confirmar Agendamento'

A mensagem será enviada automaticamente no horário escolhido. 
Você pode cancelar agendamentos pendentes a qualquer momento.

Quer testar agendando uma mensagem agora?"
```

### **🎯 SCRIPT: CHAT NÃO CARREGA**
```
"Vejo que o Chat não está carregando. Vamos resolver isso:

1. Primeiro, verifique se você tem pelo menos uma instância WhatsApp conectada:
   - Vá em Configurações > WhatsApp
   - Confirme se há instâncias com status 'Conectado'

2. Se não tiver instâncias conectadas:
   - Conecte uma instância primeiro
   - Depois volte ao Chat

3. Se tiver instâncias mas o Chat não carrega:
   - Atualize a página (Ctrl+F5)
   - Aguarde até 30 segundos
   - Verifique sua conexão com internet

Conseguiu resolver ou precisa de mais ajuda?"
```

### **🎯 SCRIPT: COMO EDITAR INFORMAÇÕES DO LEAD**
```
"Vou te mostrar como editar as informações do lead no Chat:

1. Abra uma conversa no Chat
2. No painel direito, você verá as informações do contato
3. Clique no botão 'Editar'
4. Preencha os campos desejados:
   - Nome, e-mail, status do lead
   - Valor do negócio, anotações
5. Clique em 'Salvar' para confirmar

As informações ficam salvas e você pode editá-las a qualquer momento.
Isso ajuda a organizar melhor seus leads e acompanhar o progresso.

Quer que eu te ajude a editar algum lead específico?"
```

---

## 🚨 **SITUAÇÕES DE EMERGÊNCIA**

### **🔴 SISTEMA FORA DO AR**
**Identificação:**
- Múltiplos usuários reportando problemas
- QR Code não aparece para ninguém
- Chat não carrega para ninguém
- Erro 500 ou similar

**Ação imediata:**
1. Verificar status em https://app.lovoocrm.com/
2. Escalar imediatamente para desenvolvimento
3. Comunicar aos usuários: "Identificamos instabilidade temporária no WhatsApp Integration. Nossa equipe técnica já está trabalhando na correção. Previsão de normalização: 30 minutos."

### **🔴 PROBLEMAS DE INTEGRAÇÃO**
**Identificação:**
- Instâncias não conectam
- Mensagens não chegam/saem
- Sincronização falha
- Chat não sincroniza com instâncias
- Agendamentos não executam

**Ação imediata:**
1. Escalar para nível técnico
2. Coletar informações: empresa, horário, ações realizadas
3. Monitorar se afeta outros usuários
4. Verificar se problema é específico do chat ou geral

---

## 📊 **MÉTRICAS E MONITORAMENTO**

### **📈 INDICADORES DE SUCESSO**
- Taxa de conexão bem-sucedida: >95%
- Tempo médio de conexão: <3 minutos
- Instâncias ativas: Crescimento constante
- Tickets de suporte: <5% dos usuários
- **Taxa de uso do Chat**: >80% dos usuários com instâncias
- **Tempo de carregamento do Chat**: <5 segundos
- **Mensagens enviadas com sucesso**: >98%
- **Agendamentos executados**: >95% no horário correto

### **📈 INDICADORES DE PROBLEMA**
- Taxa de falha na conexão: >10%
- Tempo de conexão: >5 minutos
- Múltiplos tickets sobre mesmo problema
- Instâncias desconectando frequentemente
- **Chat não carrega**: >10 segundos
- **Mensagens não enviam**: >5% de falha
- **Agendamentos falham**: >10% não executam
- **Múltiplos tickets sobre chat**: Mesmo problema reportado >3 vezes

---

## 🎓 **TREINAMENTO DA EQUIPE**

### **📚 CONHECIMENTOS OBRIGATÓRIOS**
- Como funciona WhatsApp Business
- Processo de conexão via QR Code
- Diferença entre WhatsApp comum e Business
- Limitações e recursos da integração
- **Como navegar no sistema de Chat** (3 colunas)
- **Filtros de conversa** (Todas/Atribuídas/Não Atribuídas)
- **Como agendar mensagens** com data/hora
- **Como editar informações** do lead
- **Diferença entre instâncias e chat** (conexão vs uso)
- **Troubleshooting básico** do chat
- Procedimentos de escalação

### **📚 CONHECIMENTOS DESEJÁVEIS**
- Conceitos básicos de API
- Como funciona webhook
- Estrutura do LovoCRM
- Troubleshooting técnico básico

---

## 🔗 **LINKS ÚTEIS**

### **📋 DOCUMENTAÇÃO TÉCNICA**
- Documentação Completa: `DOCUMENTACAO_WHATSAPP_INTEGRACAO_COMPLETA.md`
- **Sistema de Chat V2.0.0**: `CHAT_SYSTEM_README.md`
- Implementação V1.0.0: `DOCUMENTACAO_IMPLEMENTACAO_V1.0.0.md`
- Release Notes: `RELEASE_NOTES_V1.0.0.md`
- **Base de Conhecimento**: `BASE_CONHECIMENTO_WHATSAPP_SUPORTE.md` (este documento)

### **🌐 LINKS DE PRODUÇÃO**
- Sistema: https://app.lovoocrm.com/
- Repositório: https://github.com/M4Agents/loovocrm
- Status: Vercel Dashboard

### **📞 CONTATOS DE ESCALAÇÃO**
- **Nível 2 (Técnico)**: [Definir contato]
- **Nível 3 (Desenvolvimento)**: [Definir contato]
- **Emergência**: [Definir contato]

---

## 📝 **REGISTRO DE CHAMADOS**

### **📋 INFORMAÇÕES OBRIGATÓRIAS**
Para todos os chamados relacionados ao WhatsApp Integration, coletar:
- Nome da empresa/usuário
- Horário do problema
- Ação que estava realizando
- Mensagem de erro (se houver)
- Navegador utilizado
- Já tentou atualizar a página?
- **Se for problema do Chat**: Qual filtro estava usando, tinha instâncias conectadas?

### **📋 CATEGORIAS DE CHAMADOS**
- **Conexão**: Problemas para conectar WhatsApp
- **QR Code**: QR Code não aparece ou não funciona
- **Sincronização**: Instâncias desconectadas
- **Interface**: Problemas de botões ou tela
- **Dúvidas**: Como usar a funcionalidade
- **Chat**: Problemas no sistema de chat (novo)
- **Agendamento**: Problemas com mensagens agendadas (novo)
- **Leads**: Problemas ao editar informações do lead (novo)

---

## 🎉 **CONCLUSÃO**

O WhatsApp Integration V2.0.0 é uma funcionalidade **completa e robusta** que permite aos usuários conectar suas contas WhatsApp Business ao LovoCRM e utilizar um sistema de chat profissional completo.

### **✅ PONTOS FORTES**
- Sistema totalmente funcional (instâncias + chat)
- **Interface de chat profissional** com 3 colunas
- **Agendamento de mensagens** com data/hora
- **Gestão completa de leads** integrada
- **Sistema de atribuições** por usuário
- Processo de conexão simples e estável
- Correções de todos os bugs conhecidos
- Documentação completa e atualizada

### **🆕 NOVIDADES V2.0.0**
- **Sistema de Chat completo** acessível pelo menu lateral
- **Filtros inteligentes** (Todas/Atribuídas/Não Atribuídas)
- **Agendamento automático** de mensagens
- **Informações detalhadas** do lead com edição inline
- **Busca em tempo real** por conversas
- **Interface responsiva** para desktop e mobile

### **🎯 OBJETIVO DO SUPORTE**
Garantir que **100% dos usuários** consigam conectar e utilizar o WhatsApp Integration + Chat de forma eficiente, com **tempo de resolução mínimo** e **máxima satisfação**.

---

## 🚀 **NOVIDADES DA VERSÃO 2.1.0**

### **🔧 CONFIGURAÇÃO AUTOMÁTICA DE WEBHOOK (NOVO)**
- **Automação Total**: Webhook configurado automaticamente ao conectar instância
- **URL Dinâmica**: Sistema usa URL de produção configurada (https://app.lovoocrm.com/api/uazapi-webhook-final)
- **Eventos Completos**: connection, history, messages, messages_update, call, contacts
- **Sem Intervenção Manual**: Cliente não precisa configurar nada na UAZAPI
- **Baseado em Documentação Oficial**: Implementação 100% compatível com UAZAPI V2
- **Fallback Inteligente**: Se configuração falhar, sistema continua funcionando

### **🗑️ DELEÇÃO COMPLETA NA UAZAPI (NOVO)**
- **Deleção Dupla**: Remove instância do sistema E da UAZAPI
- **Desconexão Automática**: Dispositivo WhatsApp é desconectado automaticamente
- **Limpeza Total**: Não deixa instâncias "órfãs" na UAZAPI
- **Segurança Garantida**: Sempre remove do banco local, mesmo se UAZAPI falhar
- **Logs Detalhados**: Sistema registra status HTTP e respostas para troubleshooting
- **Tratamento de Erros**: HTTP 200 (sucesso), 401 (token inválido), 404 (já removida), 500 (erro servidor)

### **📱 SISTEMA DE CHAT COMPLETO**
- Interface profissional 3 colunas
- Envio e recebimento de mensagens
- Histórico completo de conversas
- Status visual das mensagens

### **⏰ AGENDAMENTO AVANÇADO**
- Agendar mensagens por data/hora
- Lista de agendamentos com status
- Cancelamento de agendamentos
- Execução automática pelo sistema

### **👤 GESTÃO DE LEADS**
- Informações detalhadas editáveis
- Status do lead configurável
- Valor do negócio em reais
- Anotações personalizadas
- Estatísticas de relacionamento

### **👥 SISTEMA DE ATRIBUIÇÕES**
- Atribuir conversas a usuários
- Filtros por atribuição
- Indicadores visuais
- Controle de acesso por empresa

---

**📅 Versão do Documento**: 2.1.0  
**📅 Data**: 03/03/2026  
**📅 Próxima Revisão**: 03/04/2026  
**✅ Status**: Ativo em Produção  
**🆕 Atualização**: Webhook Automático + Deleção UAZAPI Implementados
