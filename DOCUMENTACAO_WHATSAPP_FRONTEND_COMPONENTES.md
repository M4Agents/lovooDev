# 📱 **PARTE 6 - INTERFACE FRONTEND E COMPONENTES**

## 🎉 **STATUS: V1.0.0 IMPLEMENTADA E FUNCIONAL**
- **Data**: 17/11/2025
- **Status**: ✅ PRODUÇÃO
- **URL**: https://app.lovoocrm.com/
- **Provider**: Uazapi (100% funcional)

## 🎯 **VISÃO GERAL DA INTERFACE**

### **Conceito Principal:**
Interface unificada que permite às empresas gerenciar **ambos os providers** (Uazapi + Cloud API) de forma transparente, com componentes isolados que não afetam o sistema existente.

### **Princípios de Design:**
- 🔒 **Isolamento total** - Novos componentes não afetam existentes
- 🎨 **Consistência visual** - Seguir padrões do LovoCRM atual
- 📱 **Responsividade** - Funcionar em desktop e mobile
- ⚡ **Performance** - Carregamento rápido e eficiente
- 🔄 **Tempo real** - Atualizações instantâneas via websockets

---

## 🏗️ **ESTRUTURA DE COMPONENTES**

### **Hierarquia de Componentes IMPLEMENTADOS V1.0.0:**
```
src/components/WhatsAppLife/
├── WhatsAppLifeModule.tsx       ✅ IMPLEMENTADO - Componente principal
├── QRCodeModal.tsx             ✅ IMPLEMENTADO - Modal QR Code
├── AddInstanceModal.tsx        ✅ IMPLEMENTADO - Modal criação
└── [Componentes futuros para Cloud API]

src/hooks/
├── useWhatsAppInstancesWebhook100.ts  ✅ IMPLEMENTADO - Hook principal
└── [Hooks futuros para Cloud API]

src/types/
├── whatsapp-life.ts            ✅ IMPLEMENTADO - Tipos TypeScript
└── [Tipos futuros para Cloud API]
│   ├── InstanceManager.tsx      ✅ Gerenciador de instâncias
│   ├── InstanceCard.tsx         ✅ Card da instância
│   ├── QRCodeDisplay.tsx        ✅ Exibir QR code
│   └── InstanceForm.tsx         ✅ Formulário nova instância
├── Chat/
│   ├── ChatContainer.tsx        ✅ Container principal
│   ├── ConversationList.tsx     🔄 Lista de conversas com abas
│   ├── ConversationTabs.tsx     🆕 Abas (Entrada/Esperando/Finalizados)
│   ├── ChatHeader.tsx           🆕 Header com ações do chat
│   ├── MessageArea.tsx          ✅ Área de mensagens
│   ├── MessageBubble.tsx        ✅ Bolha de mensagem
│   ├── ChatInput.tsx            🔄 Input com abas Mensagem/Notas
│   ├── NotesInput.tsx           🆕 Input para notas do lead
│   └── InteractiveMessage.tsx   ✅ Mensagens interativas
├── Modals/
│   ├── ScheduleMessageModal.tsx 🆕 Agendamento de mensagens
│   ├── TransferModal.tsx        🆕 Transferir conversa
│   └── LeadDetailsSidebar.tsx   🆕 Detalhes do lead
├── Hooks/
│   ├── useConversationTabs.ts   🆕 Gerenciar abas de filtro
│   ├── useConversationActions.ts 🆕 Ações do chat
│   ├── useScheduledMessages.ts  🆕 Mensagens agendadas
│   └── useConversationNotes.ts  🆕 Notas da conversa
└── Settings/
    ├── WhatsAppSettings.tsx     ✅ Configurações gerais
    ├── RoutingStrategy.tsx      ✅ Estratégias de roteamento
    └── WebhookConfig.tsx        ✅ Configuração webhooks
```

---

## 🔧 **COMPONENTE PRINCIPAL**

### **WhatsAppModule.tsx**
```typescript
import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProviderSelector } from './Providers/ProviderSelector';
import { InstanceManager } from './Instances/InstanceManager';
import { ChatContainer } from './Chat/ChatContainer';
import { WhatsAppSettings } from './Settings/WhatsAppSettings';
import { useWhatsAppProviders } from '@/hooks/useWhatsAppProviders';
import { useCompany } from '@/hooks/useCompany';

export const WhatsAppModule: React.FC = () => {
  const { company } = useCompany();
  const { providers, loading, error, refetch } = useWhatsAppProviders(company?.id);
  const [activeTab, setActiveTab] = useState('chat');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="pt-6">
          <div className="text-red-600">
            Erro ao carregar módulo WhatsApp: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp</h1>
          <p className="text-gray-600">
            Gerencie suas integrações WhatsApp (Uazapi + Cloud API)
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="instances">Instâncias</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="space-y-4">
          <ChatContainer />
        </TabsContent>

        <TabsContent value="instances" className="space-y-4">
          <InstanceManager />
        </TabsContent>

        <TabsContent value="providers" className="space-y-4">
          <ProviderSelector />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <WhatsAppSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};
```

---

## 🔄 **SELETOR DE PROVIDERS**

### **ProviderSelector.tsx**
```typescript
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Settings, Trash2 } from 'lucide-react';
import { ProviderCard } from './ProviderCard';
import { UazapiConfig } from './UazapiConfig';
import { CloudApiConfig } from './CloudApiConfig';
import { useWhatsAppProviders } from '@/hooks/useWhatsAppProviders';
import { useCompany } from '@/hooks/useCompany';

export const ProviderSelector: React.FC = () => {
  const { company } = useCompany();
  const { providers, loading, createProvider, deleteProvider } = useWhatsAppProviders(company?.id);
  const [showUazapiConfig, setShowUazapiConfig] = useState(false);
  const [showCloudApiConfig, setShowCloudApiConfig] = useState(false);

  const uazapiProviders = providers.filter(p => p.provider_type === 'uazapi');
  const cloudApiProviders = providers.filter(p => p.provider_type === 'cloud-api');

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Providers WhatsApp
            <Badge variant="outline">
              {providers.length} configurado{providers.length !== 1 ? 's' : ''}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Uazapi Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Uazapi (Não Oficial)</h3>
                <Button
                  size="sm"
                  onClick={() => setShowUazapiConfig(true)}
                  className="flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </div>
              
              <div className="text-sm text-gray-600 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-green-600">✓</span>
                  QR Code simples
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-600">✓</span>
                  Mensagens interativas completas
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-600">✗</span>
                  Não oficial (pode quebrar)
                </div>
              </div>

              {uazapiProviders.length > 0 && (
                <div className="space-y-2">
                  {uazapiProviders.map(provider => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>
              )}
            </div>

            {/* Cloud API Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">WhatsApp Cloud API (Oficial)</h3>
                <Button
                  size="sm"
                  onClick={() => setShowCloudApiConfig(true)}
                  className="flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </div>
              
              <div className="text-sm text-gray-600 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-green-600">✓</span>
                  100% oficial Meta
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-600">✓</span>
                  Compliance total
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-600">✗</span>
                  Setup complexo
                </div>
              </div>

              {cloudApiProviders.length > 0 && (
                <div className="space-y-2">
                  {cloudApiProviders.map(provider => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modals */}
      {showUazapiConfig && (
        <UazapiConfig
          onClose={() => setShowUazapiConfig(false)}
          onSave={(config) => {
            createProvider('uazapi', config);
            setShowUazapiConfig(false);
          }}
        />
      )}

      {showCloudApiConfig && (
        <CloudApiConfig
          onClose={() => setShowCloudApiConfig(false)}
          onSave={(config) => {
            createProvider('cloud-api', config);
            setShowCloudApiConfig(false);
          }}
        />
      )}
    </div>
  );
};
```

---

## 💬 **INTERFACE DE CHAT COMPLETA**

### **Tipos e Interfaces Atualizadas**
```typescript
// Estados de conversa
interface ConversationStatus {
  status: 'active' | 'pending' | 'finished';
  assigned_user_id?: string;
  finished_at?: Date;
  finished_by_user_id?: string;
  transfer_note?: string;
  transferred_at?: Date;
}

// Abas de filtro
interface ConversationTab {
  id: 'todas' | 'esperando' | 'finalizados';
  label: string;
  filter: (conversations: WhatsAppConversation[]) => WhatsAppConversation[];
  badge?: number;
}

// Agendamento de mensagens
interface ScheduledMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  message: string;
  scheduled_for: Date;
  use_quick_reply: boolean;
  quick_reply_id?: string;
  cancel_if_contact_responds: boolean;
  cancel_if_agent_responds: boolean;
  status: 'pending' | 'sent' | 'cancelled';
  created_at: Date;
  sent_at?: Date;
}

// Notas da conversa
interface ConversationNote {
  id: string;
  conversation_id: string;
  user_id: string;
  user_name: string;
  note: string;
  is_private: boolean;
  created_at: Date;
}
```

### **ChatContainer.tsx (Atualizado)**
```typescript
import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { ConversationList } from './ConversationList';
import { MessageArea } from './MessageArea';
import { ChatHeader } from './ChatHeader';
import { LeadDetailsSidebar } from '../Modals/LeadDetailsSidebar';
import { ScheduleMessageModal } from '../Modals/ScheduleMessageModal';
import { TransferModal } from '../Modals/TransferModal';
import { useWhatsAppConversations } from '@/hooks/useWhatsAppConversations';
import { useWhatsAppMessages } from '@/hooks/useWhatsAppMessages';
import { useConversationActions } from '@/hooks/useConversationActions';
import { useCompany } from '@/hooks/useCompany';

export const ChatContainer: React.FC = () => {
  const { company } = useCompany();
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [showLeadDetails, setShowLeadDetails] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  
  const { 
    conversations, 
    loading: conversationsLoading,
    refetch: refetchConversations
  } = useWhatsAppConversations(company?.id);
  
  const { 
    messages, 
    loading: messagesLoading,
    sendMessage 
  } = useWhatsAppMessages(selectedConversation);

  const {
    finishConversation,
    transferConversation,
    scheduleMessage
  } = useConversationActions(selectedConversation);

  const selectedConv = conversations.find(c => c.id === selectedConversation);

  const handleFinishConversation = async () => {
    if (selectedConversation) {
      await finishConversation();
      await refetchConversations();
      setSelectedConversation(null);
    }
  };

  const handleTransferConversation = async (userId: string, note?: string) => {
    if (selectedConversation) {
      await transferConversation(userId, note);
      await refetchConversations();
      setShowTransferModal(false);
    }
  };

  const handleScheduleMessage = async (data: ScheduleMessageData) => {
    if (selectedConversation) {
      await scheduleMessage(data);
      setShowScheduleModal(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[700px]">
      {/* Lista de Conversas */}
      <Card className="lg:col-span-1">
        <ConversationList
          conversations={conversations}
          loading={conversationsLoading}
          selectedId={selectedConversation}
          onSelect={setSelectedConversation}
        />
      </Card>

      {/* Área de Chat */}
      <Card className={`${showLeadDetails ? 'lg:col-span-2' : 'lg:col-span-3'} flex flex-col`}>
        {selectedConversation && selectedConv ? (
          <>
            {/* Header do Chat */}
            <ChatHeader
              conversation={selectedConv}
              onLeadDetailsClick={() => setShowLeadDetails(!showLeadDetails)}
              onTransferClick={() => setShowTransferModal(true)}
              onScheduleClick={() => setShowScheduleModal(true)}
              onFinishClick={handleFinishConversation}
            />
            
            {/* Área de Mensagens */}
            <div className="flex-1">
              <MessageArea
                conversation={selectedConv}
                messages={messages}
                loading={messagesLoading}
                onSendMessage={sendMessage}
              />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Selecione uma conversa para começar
          </div>
        )}
      </Card>

      {/* Sidebar de Detalhes do Lead */}
      {showLeadDetails && selectedConv && (
        <Card className="lg:col-span-1">
          <LeadDetailsSidebar
            conversation={selectedConv}
            onClose={() => setShowLeadDetails(false)}
          />
        </Card>
      )}

      {/* Modais */}
      {showScheduleModal && selectedConv && (
        <ScheduleMessageModal
          isOpen={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          onSchedule={handleScheduleMessage}
          conversation={selectedConv}
        />
      )}

      {showTransferModal && selectedConv && (
        <TransferModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          onTransfer={handleTransferConversation}
          conversation={selectedConv}
        />
      )}
    </div>
  );
};
```

---

## 📋 **COMPONENTES DE ABAS E FILTROS**

### **ConversationTabs.tsx (Novo)**
```typescript
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ConversationTabsProps {
  activeTab: 'todas' | 'esperando' | 'finalizados';
  onTabChange: (tab: 'todas' | 'esperando' | 'finalizados') => void;
  pendingCount: number;
  finishedCount: number;
  totalCount: number;
}

export const ConversationTabs: React.FC<ConversationTabsProps> = ({
  activeTab,
  onTabChange,
  pendingCount,
  finishedCount,
  totalCount
}) => {
  const tabs = [
    {
      id: 'todas' as const,
      label: 'Entrada',
      count: totalCount - finishedCount
    },
    {
      id: 'esperando' as const,
      label: 'Esperando',
      count: pendingCount
    },
    {
      id: 'finalizados' as const,
      label: 'Finalizados',
      count: finishedCount
    }
  ];

  return (
    <div className="border-b bg-white">
      <nav className="flex">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-blue-500 text-blue-600 bg-blue-50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <Badge 
                variant={activeTab === tab.id ? "default" : "secondary"}
                className="text-xs"
              >
                {tab.count}
              </Badge>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};
```

### **ConversationList.tsx (Atualizado)**
```typescript
import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ConversationTabs } from './ConversationTabs';
import { ConversationItem } from './ConversationItem';
import { useConversationTabs } from '@/hooks/useConversationTabs';

interface ConversationListProps {
  conversations: WhatsAppConversation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  loading,
  selectedId,
  onSelect
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const {
    activeTab,
    setActiveTab,
    filteredConversations,
    pendingCount,
    finishedCount
  } = useConversationTabs(conversations);

  // Filtro por busca
  const searchFilteredConversations = useMemo(() => {
    if (!searchTerm) return filteredConversations;
    
    return filteredConversations.filter(conv =>
      conv.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.contact_phone.includes(searchTerm) ||
      conv.last_message_text?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [filteredConversations, searchTerm]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Abas de Filtro */}
      <ConversationTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        pendingCount={pendingCount}
        finishedCount={finishedCount}
        totalCount={conversations.length}
      />

      {/* Busca */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Lista de Conversas */}
      <div className="flex-1 overflow-y-auto">
        {searchFilteredConversations.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            {searchTerm ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa'}
          </div>
        ) : (
          searchFilteredConversations.map(conversation => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selected={selectedId === conversation.id}
              onClick={() => onSelect(conversation.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};
```

### **MessageBubble.tsx**
```typescript
import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { WhatsAppMessage } from '@/types/whatsapp';

interface MessageBubbleProps {
  message: WhatsAppMessage;
  onInteractiveClick?: (buttonId: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ 
  message, 
  onInteractiveClick 
}) => {
  const isFromMe = message.from_me;
  
  const getStatusIcon = () => {
    switch (message.status) {
      case 'pending':
        return <Clock className="h-3 w-3 text-gray-400" />;
      case 'sent':
        return <Check className="h-3 w-3 text-gray-400" />;
      case 'delivered':
        return <CheckCheck className="h-3 w-3 text-gray-400" />;
      case 'read':
        return <CheckCheck className="h-3 w-3 text-blue-500" />;
      case 'failed':
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      default:
        return null;
    }
  };

  const renderInteractiveContent = () => {
    if (message.message_type !== 'interactive' || !message.interactive_data) {
      return null;
    }

    const { type, buttons, list } = message.interactive_data;

    if (type === 'button' && buttons) {
      return (
        <div className="space-y-2 mt-2">
          {buttons.map((button: any, index: number) => (
            <Button
              key={index}
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onInteractiveClick?.(button.id)}
            >
              {button.title}
            </Button>
          ))}
        </div>
      );
    }

    if (type === 'list' && list) {
      return (
        <div className="mt-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onInteractiveClick?.(list.button_id)}
          >
            {list.button_text}
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={cn(
      "flex mb-4",
      isFromMe ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "max-w-xs lg:max-w-md px-4 py-2 rounded-lg",
        isFromMe 
          ? "bg-blue-500 text-white" 
          : "bg-gray-100 text-gray-900"
      )}>
        {/* Sender Name (for received messages) */}
        {!isFromMe && message.sender_name && (
          <div className="text-xs font-semibold text-gray-600 mb-1">
            {message.sender_name}
          </div>
        )}

        {/* Message Content */}
        <div className="text-sm">
          {message.text_content}
        </div>

        {/* Interactive Content */}
        {renderInteractiveContent()}

        {/* Message Info */}
        <div className={cn(
          "flex items-center justify-between mt-2 text-xs",
          isFromMe ? "text-blue-100" : "text-gray-500"
        )}>
          <span>
            {new Date(message.timestamp).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
          
          {isFromMe && (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs">
                {message.provider_type}
              </Badge>
              {getStatusIcon()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

---

## ⚙️ **HOOKS PERSONALIZADOS**

### **useWhatsAppProviders.ts**
```typescript
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { WhatsAppProvider } from '@/types/whatsapp';

export const useWhatsAppProviders = (companyId?: string) => {
  const [providers, setProviders] = useState<WhatsAppProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProviders = async () => {
    if (!companyId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('whatsapp_providers')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProviders(data || []);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const createProvider = async (type: 'uazapi' | 'cloud-api', config: any) => {
    if (!companyId) return;

    try {
      const { data, error } = await supabase
        .from('whatsapp_providers')
        .insert({
          company_id: companyId,
          provider_type: type,
          provider_name: config.name,
          config: config,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;
      setProviders(prev => [data, ...prev]);
      return data;
    } catch (err) {
      throw err;
    }
  };

  const updateProvider = async (id: string, updates: Partial<WhatsAppProvider>) => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_providers')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setProviders(prev => prev.map(p => p.id === id ? data : p));
      return data;
    } catch (err) {
      throw err;
    }
  };

  const deleteProvider = async (id: string) => {
    try {
      const { error } = await supabase
        .from('whatsapp_providers')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setProviders(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      throw err;
    }
  };

  useEffect(() => {
    fetchProviders();
  }, [companyId]);

  return {
    providers,
    loading,
    error,
    refetch: fetchProviders,
    createProvider,
    updateProvider,
    deleteProvider
  };
};
```

---

## 🔧 **INTEGRAÇÃO COM SETTINGS EXISTENTE**

### **Modificação em Settings.tsx**
```typescript
// src/components/Settings/Settings.tsx
import { WhatsAppModule } from '@/components/WhatsApp/WhatsAppModule';

// Adicionar nova aba no array de tabs existente
const tabs = [
  // ... tabs existentes
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    component: WhatsAppModule
  }
];
```

---

---

## 🎯 **HEADER DO CHAT COM AÇÕES**

### **ChatHeader.tsx (Novo)**
```typescript
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, ArrowUpRight, Calendar, Check, Phone, MessageCircle } from 'lucide-react';

interface ChatHeaderProps {
  conversation: WhatsAppConversation;
  lead?: Lead;
  onLeadDetailsClick: () => void;
  onTransferClick: () => void;
  onScheduleClick: () => void;
  onFinishClick: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  conversation,
  lead,
  onLeadDetailsClick,
  onTransferClick,
  onScheduleClick,
  onFinishClick
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'disconnected': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="flex items-center justify-between p-4 border-b bg-white">
      {/* Info do Contato/Lead */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Avatar className="h-12 w-12">
            <AvatarImage src={conversation.contact_profile_pic} />
            <AvatarFallback className="bg-blue-100 text-blue-600">
              {conversation.contact_name?.charAt(0) || conversation.contact_phone.slice(-2)}
            </AvatarFallback>
          </Avatar>
          
          {/* Indicador de status online */}
          {conversation.is_online && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full"></div>
          )}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">
              {lead?.name || conversation.contact_name || 'Contato WhatsApp'}
            </h3>
            
            {lead && (
              <Badge variant="outline" className="text-xs">
                Lead #{lead.id.slice(-6)}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              <span>{conversation.contact_phone}</span>
            </div>
            
            <div className="flex items-center gap-1">
              <MessageCircle className="h-3 w-3" />
              <Badge 
                variant="outline" 
                className={cn("text-xs", {
                  "border-green-200 text-green-700": conversation.provider_type === 'uazapi',
                  "border-blue-200 text-blue-700": conversation.provider_type === 'cloud-api'
                })}
              >
                {conversation.provider_type === 'uazapi' ? 'Uazapi' : 'Cloud API'}
              </Badge>
            </div>
            
            {conversation.instance_status && (
              <div className="flex items-center gap-1">
                <div className={cn("w-2 h-2 rounded-full", getStatusColor(conversation.instance_status))}></div>
                <span className="capitalize">{conversation.instance_status}</span>
              </div>
            )}
          </div>
          
          {conversation.last_seen && !conversation.is_online && (
            <div className="text-xs text-gray-500">
              Visto por último: {formatDistanceToNow(conversation.last_seen, { locale: ptBR })}
            </div>
          )}
        </div>
      </div>

      {/* Ações do Header */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onLeadDetailsClick}
          title="Detalhes do Lead"
          className="h-9 w-9 p-0"
        >
          <User className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onTransferClick}
          title="Transferir conversa"
          className="h-9 w-9 p-0"
        >
          <ArrowUpRight className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onScheduleClick}
          title="Agendar mensagem"
          className="h-9 w-9 p-0"
        >
          <Calendar className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onFinishClick}
          title="Finalizar conversa"
          className="h-9 w-9 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
```

---

## 📝 **INPUT COM ABAS (MENSAGEM + NOTAS)**

### **ChatInput.tsx (Atualizado)**
```typescript
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Send, Paperclip, Smile, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  conversation: WhatsAppConversation;
  onSendMessage: (message: string) => void;
  onSaveNote: (note: string, isPrivate: boolean) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  conversation,
  onSendMessage,
  onSaveNote
}) => {
  const [activeTab, setActiveTab] = useState<'message' | 'notes'>('message');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);

  const handleSendMessage = () => {
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleSaveNote = () => {
    if (note.trim()) {
      onSaveNote(note.trim(), isPrivateNote);
      setNote('');
      setIsPrivateNote(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === 'message') {
        handleSendMessage();
      } else {
        handleSaveNote();
      }
    }
  };

  return (
    <div className="border-t bg-white">
      {/* Abas */}
      <div className="border-b">
        <nav className="flex">
          <button
            onClick={() => setActiveTab('message')}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === 'message'
                ? "border-blue-500 text-blue-600 bg-blue-50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            <Send className="h-4 w-4" />
            Mensagem
          </button>
          
          <button
            onClick={() => setActiveTab('notes')}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === 'notes'
                ? "border-blue-500 text-blue-600 bg-blue-50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            <FileText className="h-4 w-4" />
            Notas
          </button>
        </nav>
      </div>

      {/* Conteúdo das Abas */}
      <div className="p-4">
        {activeTab === 'message' ? (
          <div className="space-y-3">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Digite sua mensagem ou arraste um arquivo..."
              className="min-h-[80px] resize-none"
              maxLength={4096}
            />
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Smile className="h-4 w-4" />
                </Button>
                
                <div className="text-xs text-gray-500">
                  {message.length}/4096
                </div>
              </div>
              
              <Button 
                onClick={handleSendMessage}
                disabled={!message.trim()}
                size="sm"
                className="flex items-center gap-2"
              >
                <Send className="h-4 w-4" />
                Enviar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Adicione uma nota sobre este lead..."
              className="min-h-[80px] resize-none"
              maxLength={1000}
            />
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isPrivateNote}
                    onChange={(e) => setIsPrivateNote(e.target.checked)}
                    className="rounded"
                  />
                  Nota privada
                </label>
                
                <div className="text-xs text-gray-500">
                  {note.length}/1000
                </div>
              </div>
              
              <Button 
                onClick={handleSaveNote}
                disabled={!note.trim()}
                size="sm"
                variant="outline"
                className="flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Salvar Nota
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
```

---

## 📅 **MODAL DE AGENDAMENTO**

### **ScheduleMessageModal.tsx (Novo)**
```typescript
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Clock } from 'lucide-react';

interface ScheduleMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (data: ScheduleMessageData) => void;
  conversation: WhatsAppConversation;
}

interface ScheduleMessageData {
  message: string;
  scheduledFor: Date;
  useQuickReply: boolean;
  quickReplyId?: string;
  cancelIfContactResponds: boolean;
  cancelIfAgentResponds: boolean;
}

export const ScheduleMessageModal: React.FC<ScheduleMessageModalProps> = ({
  isOpen,
  onClose,
  onSchedule,
  conversation
}) => {
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [useQuickReply, setUseQuickReply] = useState(false);
  const [quickReplyId, setQuickReplyId] = useState('');
  const [cancelIfContactResponds, setCancelIfContactResponds] = useState(false);
  const [cancelIfAgentResponds, setCancelIfAgentResponds] = useState(false);

  const quickReplies = [
    { id: 'greeting', text: 'Olá! Como posso ajudá-lo?' },
    { id: 'followup', text: 'Gostaria de saber se ainda tem interesse...' },
    { id: 'reminder', text: 'Lembrando sobre nossa conversa anterior.' }
  ];

  const handleSchedule = () => {
    if (!message.trim() || !date || !time) return;

    const scheduledDateTime = new Date(`${date}T${time}`);
    
    const data: ScheduleMessageData = {
      message: useQuickReply ? quickReplies.find(q => q.id === quickReplyId)?.text || message : message,
      scheduledFor: scheduledDateTime,
      useQuickReply,
      quickReplyId: useQuickReply ? quickReplyId : undefined,
      cancelIfContactResponds,
      cancelIfAgentResponds
    };

    onSchedule(data);
  };

  // Data mínima é agora + 1 minuto
  const minDateTime = new Date();
  minDateTime.setMinutes(minDateTime.getMinutes() + 1);
  
  const minDate = minDateTime.toISOString().split('T')[0];
  const minTime = minDateTime.toTimeString().slice(0, 5);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Agendar Mensagem
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Seleção de Data e Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="date">Data</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={minDate}
                required
              />
            </div>
            <div>
              <Label htmlFor="time">Hora</Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                min={date === minDate ? minTime : undefined}
                required
              />
            </div>
          </div>

          {/* Preview da data */}
          {date && time && (
            <div className="text-sm text-blue-600 bg-blue-50 p-2 rounded">
              <Clock className="h-4 w-4 inline mr-1" />
              Será enviado em {new Date(`${date}T${time}`).toLocaleString('pt-BR')}
            </div>
          )}

          {/* Resposta Rápida */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="useQuickReply"
                checked={useQuickReply}
                onCheckedChange={setUseQuickReply}
              />
              <Label htmlFor="useQuickReply">Utilizar uma resposta rápida</Label>
            </div>

            {useQuickReply && (
              <Select value={quickReplyId} onValueChange={setQuickReplyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma resposta rápida" />
                </SelectTrigger>
                <SelectContent>
                  {quickReplies.map((reply) => (
                    <SelectItem key={reply.id} value={reply.id}>
                      {reply.text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Mensagem */}
          <div>
            <Label htmlFor="message">Mensagem</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={useQuickReply ? "A mensagem será preenchida automaticamente" : "Digite sua mensagem..."}
              disabled={useQuickReply}
              className="min-h-[80px]"
              maxLength={4096}
            />
          </div>

          {/* Opções de Cancelamento */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="cancelIfContact"
                checked={cancelIfContactResponds}
                onCheckedChange={setCancelIfContactResponds}
              />
              <Label htmlFor="cancelIfContact" className="text-sm">
                Cancelar se contato enviar nova mensagem
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="cancelIfAgent"
                checked={cancelIfAgentResponds}
                onCheckedChange={setCancelIfAgentResponds}
              />
              <Label htmlFor="cancelIfAgent" className="text-sm">
                Cancelar se atendente enviar nova mensagem
              </Label>
            </div>
          </div>

          {/* Botões */}
          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button 
              onClick={handleSchedule}
              disabled={!message.trim() || !date || !time}
              className="flex-1"
            >
              Agendar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

---

## 🔄 **HOOKS PERSONALIZADOS ATUALIZADOS**

### **useConversationTabs.ts (Novo)**
```typescript
import { useState, useMemo } from 'react';
import { WhatsAppConversation } from '@/types/whatsapp';

export const useConversationTabs = (conversations: WhatsAppConversation[]) => {
  const [activeTab, setActiveTab] = useState<'todas' | 'esperando' | 'finalizados'>('todas');

  const filteredConversations = useMemo(() => {
    switch (activeTab) {
      case 'esperando':
        return conversations.filter(c => 
          c.unread_count > 0 && 
          !c.last_message_from_me && 
          c.status !== 'finished'
        );
      case 'finalizados':
        return conversations.filter(c => c.status === 'finished');
      case 'todas':
      default:
        return conversations.filter(c => c.status !== 'finished');
    }
  }, [conversations, activeTab]);

  const pendingCount = useMemo(() => 
    conversations.filter(c => 
      c.unread_count > 0 && 
      !c.last_message_from_me && 
      c.status !== 'finished'
    ).length,
    [conversations]
  );

  const finishedCount = useMemo(() => 
    conversations.filter(c => c.status === 'finished').length,
    [conversations]
  );

  return {
    activeTab,
    setActiveTab,
    filteredConversations,
    pendingCount,
    finishedCount
  };
};
```

### **useConversationActions.ts (Novo)**
```typescript
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

export const useConversationActions = (conversationId?: string) => {
  const { toast } = useToast();

  const finishConversation = async () => {
    if (!conversationId) return;

    try {
      const { error } = await supabase.rpc('finish_whatsapp_conversation', {
        p_conversation_id: conversationId,
        p_user_id: (await supabase.auth.getUser()).data.user?.id
      });

      if (error) throw error;

      toast({
        title: "Conversa finalizada",
        description: "A conversa foi marcada como finalizada com sucesso."
      });
    } catch (error) {
      toast({
        title: "Erro ao finalizar conversa",
        description: error.message,
        variant: "destructive"
      });
      throw error;
    }
  };

  const transferConversation = async (targetUserId: string, note?: string) => {
    if (!conversationId) return;

    try {
      const { error } = await supabase.rpc('transfer_whatsapp_conversation', {
        p_conversation_id: conversationId,
        p_target_user_id: targetUserId,
        p_transfer_note: note,
        p_current_user_id: (await supabase.auth.getUser()).data.user?.id
      });

      if (error) throw error;

      toast({
        title: "Conversa transferida",
        description: "A conversa foi transferida com sucesso."
      });
    } catch (error) {
      toast({
        title: "Erro ao transferir conversa",
        description: error.message,
        variant: "destructive"
      });
      throw error;
    }
  };

  const scheduleMessage = async (data: ScheduleMessageData) => {
    if (!conversationId) return;

    try {
      const { error } = await supabase
        .from('scheduled_messages')
        .insert({
          conversation_id: conversationId,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          message: data.message,
          scheduled_for: data.scheduledFor.toISOString(),
          use_quick_reply: data.useQuickReply,
          quick_reply_id: data.quickReplyId,
          cancel_if_contact_responds: data.cancelIfContactResponds,
          cancel_if_agent_responds: data.cancelIfAgentResponds
        });

      if (error) throw error;

      toast({
        title: "Mensagem agendada",
        description: `Mensagem será enviada em ${data.scheduledFor.toLocaleString('pt-BR')}`
      });
    } catch (error) {
      toast({
        title: "Erro ao agendar mensagem",
        description: error.message,
        variant: "destructive"
      });
      throw error;
    }
  };

  const addNote = async (note: string, isPrivate: boolean = false) => {
    if (!conversationId) return;

    try {
      const { error } = await supabase
        .from('conversation_notes')
        .insert({
          conversation_id: conversationId,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          note,
          is_private: isPrivate
        });

      if (error) throw error;

      toast({
        title: "Nota adicionada",
        description: "A nota foi salva com sucesso."
      });
    } catch (error) {
      toast({
        title: "Erro ao salvar nota",
        description: error.message,
        variant: "destructive"
      });
      throw error;
    }
  };

  return {
    finishConversation,
    transferConversation,
    scheduleMessage,
    addNote
  };
};
```

---

**Documento atualizado em**: 13/11/2025 11:41  
**Versão**: 2.0 - Interface Frontend Completa com Novas Funcionalidades  
**Arquivo complementar**: DOCUMENTACAO_WHATSAPP_INTEGRACAO_COMPLETA.md
