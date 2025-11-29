# FOTO CHAT – DOCUMENTAÇÃO COMPLETA

## 1. Visão geral

Objetivo: exibir a **foto do lead** (avatar do WhatsApp) na **lista de conversas do chat** (sidebar esquerda), mantendo:

- Foto vinda da Uazapi / WhatsApp quando existir.
- Avatar cinza padrão quando **não** houver foto.
- Sistema 100% funcional, sem alterar lógicas de negócio.

Ambientes envolvidos:

- **Dev / lovooDev** – repositório atual deste workspace (`M4Agents/lovooDev`).
- **Oficial / loovocrm** – repositório de produção (`M4Agents/loovocrm`), que ainda precisa ser atualizado manualmente com estas mudanças.
- **Banco de dados** – Supabase projeto **M4_Digital** (`etzdsywunlpbgxkphuil`), compartilhado pelos dois frontends.

---

## 2. Fluxo da foto do lead (backend)

### 2.1. Webhook Uazapi de recebimento – `api/uazapi-webhook-final.js`

Arquivo no dev: `api/uazapi-webhook-final.js`.

Responsabilidades principais:

- Receber payloads da Uazapi.
- Criar/atualizar:
  - `chat_contacts`
  - `chat_conversations`
  - `chat_messages`
- Criar leads automaticamente.
- Sincronizar **foto de perfil** do contato.

Pontos relevantes para foto:

1. **Criação de contato** em `chat_contacts`:

```js
const { data: newContact, error: contactError } = await supabase
  .from('chat_contacts')
  .insert({
    phone_number: phoneNumber,
    name: senderName,
    company_id: company.id,
    lead_source: 'whatsapp_webhook',
    profile_picture_url: payload.chat?.imagePreview || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  })
  .select('id')
  .single()
```

2. **Sincronização assíncrona da foto via Uazapi**:

```js
syncContactProfilePictureFromUazapi({
  supabase,
  baseUrl: payload.BaseUrl,
  token: payload.token,
  instanceName,
  companyId: company.id,
  phoneNumber,
})
```

3. Função `syncContactProfilePictureFromUazapi`:

- Chama `https://api.uazapi.com/chat/GetNameAndImageURL/{instanceName}`.
- Obtém `profilePictureUrl`.
- Faz download e salva em **Supabase Storage** (`chat-media`) via `downloadAndStoreContactAvatar`.
- Atualiza `chat_contacts`:

```js
await supabase
  .from('chat_contacts')
  .update({ profile_picture_url: finalUrl, updated_at: new Date().toISOString() })
  .eq('company_id', companyId)
  .eq('phone_number', phoneNumber)
```

**Conclusão:** a URL estável da foto do contato fica em `chat_contacts.profile_picture_url`.

---

## 3. Dados de chat no frontend (dev / lovooDev)

### 3.1. Tipos TypeScript – `src/types/whatsapp-chat.ts`

Tipo principal utilizado pelo chat:

```ts
export interface ChatConversation {
  id: string
  company_id: string
  instance_id: string
  contact_phone: string
  contact_name?: string
  profile_picture_url?: string
  assigned_to?: {
    id: string
    email: string
  }
  last_message_at?: Date
  last_message_content?: string
  last_message_direction?: 'inbound' | 'outbound'
  unread_count: number
  status: 'active' | 'archived'
  instance_name?: string
  created_at: Date
  updated_at: Date
}

export interface ChatContact {
  id: string
  company_id: string
  phone_number: string
  name?: string
  email?: string
  profile_picture_url?: string
  ...
}
```

### 3.2. API do chat – `src/services/chat/chatApi.ts`

#### 3.2.1. Obtenção de conversas

```ts
static async getConversations(
  companyId: string,
  userId: string,
  filter: ConversationFilter,
  instanceId?: string,
  limit: number = 50,
  offset: number = 0
): Promise<ChatConversation[]> {
  const { data, error } = await supabase.rpc('chat_get_conversations', {
    p_company_id: companyId,
    p_user_id: userId,
    p_filter_type: filter.type,
    p_instance_id: instanceId || null,
    p_limit: limit,
    p_offset: offset
  })

  ...

  return (data.data || []).map(this.mapConversation)
}
```

#### 3.2.2. Mapeamento de conversa (IMPORTANTE)

```ts
private static mapConversation(raw: any): ChatConversation {
  return {
    id: raw.id,
    company_id: raw.company_id,
    instance_id: raw.instance_id,
    contact_phone: raw.contact_phone,
    contact_name: raw.contact_name,
    profile_picture_url: raw.profile_picture_url,
    assigned_to: raw.assigned_to,
    last_message_at: raw.last_message_at ? new Date(raw.last_message_at) : undefined,
    last_message_content: raw.last_message_content,
    last_message_direction: raw.last_message_direction,
    unread_count: raw.unread_count || 0,
    status: raw.status,
    instance_name: raw.instance_name,
    created_at: new Date(raw.created_at),
    updated_at: new Date(raw.updated_at)
  }
}
```

**Observação:** o backend precisa devolver `profile_picture_url` no JSON da RPC `chat_get_conversations`.

### 3.3. Uso da foto em outras áreas (já funcionava)

- **ChatArea** (`src/components/WhatsAppChat/ChatArea/ChatArea.tsx`):
  - Usa `chatApi.getContactInfo(companyId, conv.contact_phone)`.
  - Salva `contactInfo.profile_picture_url` em estado local para mostrar no topo do chat.

- **LeadPanel** (`src/components/WhatsAppChat/LeadPanel/LeadPanel.tsx`):
  - Também consome `chatApi.getContactInfo`.
  - Mostra a foto grande na lateral direita.

Ou seja, o fluxo da foto **já funcionava** para o chat aberto e o painel direito.

---

## 4. Correção aplicada no backend (Supabase) – `chat_get_conversations`

Projeto Supabase: **M4_Digital** (`etzdsywunlpbgxkphuil`).

Função antes da correção **NÃO** retornava foto; apenas dados da tabela `chat_conversations` + `auth.users` + `whatsapp_life_instances`.

### 4.1. Versão atual da função (com foto)

Principais pontos da função:

```sql
CREATE OR REPLACE FUNCTION public.chat_get_conversations(
    p_company_id uuid,
    p_user_id uuid,
    p_filter_type text,
    p_instance_id uuid DEFAULT NULL::uuid,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_conversations jsonb;
BEGIN
    -- Verificar se o usuário tem acesso à empresa
    IF NOT EXISTS (
        SELECT 1 FROM companies 
        WHERE id = p_company_id AND user_id = p_user_id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Acesso negado à empresa'
        );
    END IF;

    -- Buscar conversas com filtros + foto do contato
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', cc.id,
            'company_id', cc.company_id,
            'instance_id', cc.instance_id,
            'contact_phone', cc.contact_phone,
            'contact_name', cc.contact_name,
            -- NOVO: foto do contato via chat_contacts
            'profile_picture_url', ctc.profile_picture_url,
            'assigned_to', CASE 
                WHEN cc.assigned_to IS NOT NULL THEN
                    jsonb_build_object(
                        'id', cc.assigned_to,
                        'email', au.email
                    )
                ELSE NULL
            END,
            'last_message_at', cc.last_message_at,
            'last_message_content', cc.last_message_content,
            'last_message_direction', cc.last_message_direction,
            'unread_count', cc.unread_count,
            'status', cc.status,
            'instance_name', wli.instance_name,
            'created_at', cc.created_at,
            'updated_at', cc.updated_at
        ) ORDER BY cc.last_message_at DESC NULLS LAST
    ) INTO v_conversations
    FROM chat_conversations cc
    LEFT JOIN auth.users au 
        ON cc.assigned_to = au.id
    LEFT JOIN whatsapp_life_instances wli 
        ON cc.instance_id = wli.id
    LEFT JOIN chat_contacts ctc
        ON ctc.company_id = cc.company_id
       AND ctc.phone_number = cc.contact_phone
    WHERE cc.company_id = p_company_id
        AND (p_instance_id IS NULL OR cc.instance_id = p_instance_id)
        AND CASE 
            WHEN p_filter_type = 'assigned' THEN cc.assigned_to = p_user_id
            WHEN p_filter_type = 'unassigned' THEN cc.assigned_to IS NULL
            ELSE TRUE
        END
        AND cc.status = 'active'
    LIMIT p_limit OFFSET p_offset;

    RETURN jsonb_build_object(
        'success', TRUE,
        'data', COALESCE(v_conversations, '[]'::jsonb)
    );
END;
$function$;
```

**Resumo:**

- Foi adicionado apenas:
  - `LEFT JOIN chat_contacts ctc ON ctc.company_id = cc.company_id AND ctc.phone_number = cc.contact_phone`.
  - Campo `'profile_picture_url', ctc.profile_picture_url` no JSON.
- Nenhuma outra lógica de filtro, segurança ou ordenação foi alterada.

---

## 5. Correção aplicada no frontend (dev / lovooDev)

### 5.1. Componente da sidebar de conversas – `ConversationSidebar`

Arquivo: `src/components/WhatsAppChat/ConversationSidebar/ConversationSidebar.tsx`.

A lista de conversas renderiza um `ConversationItem` para cada conversa.

#### 5.1.1. Antes da correção (comportamento antigo)

```tsx
{filteredConversations.map(conversation => (
  <ConversationItem
    key={conversation.id}
    conversation={conversation}
    isSelected={conversation.id === selectedConversation}
    onClick={() => onSelectConversation(conversation.id)}
    // NÃO passava foto; photoUrl ficava undefined
  />
))}
```

O `ConversationItem` já tinha suporte à prop `photoUrl`, mas como ela não era passada, sempre usava o **avatar cinza**.

#### 5.1.2. Depois da correção (atual)

```tsx
{filteredConversations.map(conversation => (
  <ConversationItem
    key={conversation.id}
    conversation={conversation}
    isSelected={conversation.id === selectedConversation}
    onClick={() => onSelectConversation(conversation.id)}
    photoUrl={conversation.profile_picture_url}
  />
))}
```

### 5.2. Componente `ConversationItem`

Trecho relevante:

```tsx
interface ConversationItemProps {
  conversation: ChatConversation
  isSelected: boolean
  onClick: () => void
  photoUrl?: string
}

...

<div className="flex-shrink-0">
  {photoUrl ? (
    <img
      src={photoUrl}
      alt={conversation.contact_name || conversation.contact_phone || 'Contato'}
      className="w-12 h-12 rounded-xl object-cover shadow-sm bg-slate-200"
    />
  ) : (
    <div className="w-12 h-12 bg-gradient-to-br from-slate-300 to-slate-400 rounded-xl flex items-center justify-center shadow-sm">
      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
      </svg>
    </div>
  )}
</div>
```

Comportamento final:

- Se `photoUrl` existir → mostra a **foto real do lead**.
- Se `photoUrl` não existir → mantém o **avatar cinza**.

---

## 6. O que precisa ser atualizado na versão oficial (`M4Agents/loovocrm`)

Como o banco é compartilhado, o Supabase **já está pronto** (função `chat_get_conversations` atualizada). Falta replicar apenas as partes de frontend no repositório oficial.

### 6.1. Passos no repositório oficial

Repositório oficial: `https://github.com/M4Agents/loovocrm`.

1. **Garantir que o tipo `ChatConversation` tenha `profile_picture_url`**

   No arquivo de tipos do chat (equivalente ao `src/types/whatsapp-chat.ts`):

   ```ts
   export interface ChatConversation {
     id: string
     company_id: string
     instance_id: string
     contact_phone: string
     contact_name?: string
     profile_picture_url?: string   // garantir que exista
     ...
   }
   ```

2. **Garantir que o mapeamento da API leia `profile_picture_url`**

   No serviço de chat (equivalente a `src/services/chat/chatApi.ts`):

   ```ts
   private static mapConversation(raw: any): ChatConversation {
     return {
       id: raw.id,
       company_id: raw.company_id,
       instance_id: raw.instance_id,
       contact_phone: raw.contact_phone,
       contact_name: raw.contact_name,
       profile_picture_url: raw.profile_picture_url, // linha obrigatória
       ...
     }
   }
   ```

3. **Atualizar a sidebar de conversas para passar a foto**

   No componente de lista de conversas do chat (equivalente a `ConversationSidebar` em `lovooDev`):

   - Localizar o `map` que renderiza cada conversa:

   ```tsx
   {filteredConversations.map(conversation => (
     <ConversationItem
       key={conversation.id}
       conversation={conversation}
       isSelected={conversation.id === selectedConversation}
       onClick={() => onSelectConversation(conversation.id)}
       // aqui precisa entrar a foto
     />
   ))}
   ```

   - Ajustar para:

   ```tsx
   <ConversationItem
     key={conversation.id}
     conversation={conversation}
     isSelected={conversation.id === selectedConversation}
     onClick={() => onSelectConversation(conversation.id)}
     photoUrl={conversation.profile_picture_url}
   />
   ```

4. **Confirmar fallback no componente do item**

   No componente que representa cada item da conversa (equivalente a `ConversationItem`):

   - Garantir que a prop `photoUrl?: string` exista.
   - Confirmar que o JSX tem a mesma lógica:

   ```tsx
   {photoUrl ? (
     <img src={photoUrl} ... />
   ) : (
     // avatar cinza existente
   )}
   ```

5. **Testes recomendados na versão oficial**

   - Abrir o módulo de Chat na versão oficial.
   - Selecionar uma conversa de lead **com foto** (por exemplo, Benício):
     - Ver se a foto aparece:
       - No topo do chat.
       - No painel direito (Lead).
       - **Na lista de conversas** (avatar da esquerda).
   - Selecionar um lead **sem foto**:
     - Confirmar que o avatar cinza continua aparecendo normalmente.
   - Validar filtros (Todas / Atribuídas / Não Atribuídas) e busca para garantir que nada foi quebrado.

6. **Commit sugerido para o repo oficial**

   Mensagem de commit recomendada:

   ```bash
   git commit -m "feat(chat): exibir foto do lead na lista de conversas quando disponível"
   ```

---

## 7. Resumo executivo

- **Backend (Supabase)**:
  - Função `chat_get_conversations` atualizada para fazer `JOIN` com `chat_contacts` e expor `profile_picture_url` no JSON.
  - Nenhuma outra lógica foi alterada.

- **Frontend (dev / lovooDev)**:
  - `ChatConversation` já possui `profile_picture_url`.
  - `chatApi.mapConversation` mapeia `raw.profile_picture_url`.
  - `ConversationSidebar` passa `photoUrl={conversation.profile_picture_url}` para `ConversationItem`.
  - `ConversationItem` mostra a foto se existir; caso contrário, mantém avatar cinza.

- **O que falta na versão oficial (`loovocrm`)**:
  - Replicar exatamente as mesmas três garantias:
    1. Tipo `ChatConversation` com `profile_picture_url`.
    2. `mapConversation` lendo `raw.profile_picture_url`.
    3. Sidebar de conversas passando `photoUrl={conversation.profile_picture_url}` para o item.

Com essas etapas, a versão oficial terá o mesmo comportamento visual do ambiente de desenvolvimento, exibindo a foto do lead na lista de conversas sempre que disponível, sem alterar a lógica já validada do sistema.
