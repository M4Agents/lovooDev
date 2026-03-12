# SISTEMA DE ATIVIDADES - INSTRUÇÕES DE IMPLEMENTAÇÃO

**Data:** 10/03/2026  
**Status:** ✅ API Funcionando | 📋 Aguardando Implementação Frontend

---

## ✅ PROGRESSO ATUAL

### **API de Atividades - FUNCIONANDO 100%**
- ✅ Endpoint: `/api/activities/lead/[leadId]`
- ✅ Erro 500 corrigido (ES Modules vs CommonJS)
- ✅ Erro 404 corrigido (Vercel não reconhecia .cjs)
- ✅ Erro supabaseUrl corrigido (VITE_SUPABASE_URL)
- ✅ Badge mostrando "2 atividades"
- ✅ Banner mostrando atividade atrasada
- ✅ Popover mostrando próxima atividade

### **Commits Realizados**
- `43f4d77`: Conversão para ES Modules
- `48f7811`: Correção variáveis ambiente (VITE_SUPABASE_URL)

---

## ❌ PROBLEMAS IDENTIFICADOS

### **Problema 1: Click nas atividades não abre modal**
- `ActivityBadge` tem prop `onActivityClick` mas não é passada em `ChatArea`
- `ActivityBanner` tem prop `onViewDetails` mas não é passada em `ChatArea`
- Modal `ActivityModal` existe mas não está integrado

### **Problema 2: Popover mostra "+ 1 outra" mas não lista**
- `ActivityBadge` renderiza apenas `activities[0]`
- Contador indica outras atividades mas não as exibe
- Usuário não consegue ver/clicar nas demais

---

## 🔧 INSTRUÇÕES DE IMPLEMENTAÇÃO

### **ARQUIVO 1: ActivityBadge.tsx**
**Localização:** `src/components/WhatsAppChat/ChatArea/ActivityBadge.tsx`

#### **Mudança 1 - Linha 76-85:** Substituir por:
```typescript
  const getActivityEmoji = (type: string) => {
    const emojis: Record<string, string> = {
      task: '✅', call: '📞', meeting: '🤝',
      email: '📧', follow_up: '🔄', other: '📋'
    }
    return emojis[type] || '📅'
  }
```

#### **Mudança 2 - Linha 106-143:** Substituir TODO o tooltip por:
```typescript
      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white rounded-lg shadow-xl border border-gray-200 max-h-96 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 sticky top-0">
            <p className="text-xs font-semibold text-gray-700">{totalCount} {totalCount === 1 ? 'Atividade' : 'Atividades'}</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {activities.map((activity, idx) => (
              <div
                key={activity.id}
                onClick={() => { setShowTooltip(false); onActivityClick?.(activity); }}
                className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${idx !== activities.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg">{getActivityEmoji(activity.activity_type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{activity.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {new Date(activity.scheduled_date).toLocaleDateString('pt-BR')} às {activity.scheduled_time}
                    </p>
                    {activity.is_overdue && <p className="text-xs text-red-600 font-medium mt-1">⚠️ Atrasada</p>}
                    {activity.is_today && !activity.is_overdue && <p className="text-xs text-yellow-600 font-medium mt-1">⏰ Hoje</p>}
                    {activity.is_urgent && !activity.is_today && !activity.is_overdue && <p className="text-xs text-orange-600 font-medium mt-1">🔔 Amanhã</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-500">Clique para ver detalhes</p>
          </div>
        </div>
      )}
```

---

### **ARQUIVO 2: ActivityBanner.tsx**
**Localização:** `src/components/WhatsAppChat/ChatArea/ActivityBanner.tsx`

#### **Mudança 1 - Linha 21:** Alterar interface:
```typescript
  onViewDetails?: (activity: Activity) => void
```

#### **Mudança 2 - Linha 123:** Alterar botão:
```typescript
            onClick={() => onViewDetails?.(urgentActivity)}
```

---

### **ARQUIVO 3: ChatArea.tsx**
**Localização:** `src/components/WhatsAppChat/ChatArea/ChatArea.tsx`

#### **Adicionar no topo (após imports):**
```typescript
import { ActivityModal } from '../../Calendar/ActivityModal'
```

#### **Adicionar estados (após outros useState):**
```typescript
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<any>(null)
```

#### **Adicionar função (antes do return):**
```typescript
  const handleOpenActivity = (activity?: any) => {
    setSelectedActivity(activity || null)
    setShowActivityModal(true)
  }
```

#### **Modificar ActivityBadge (linha ~975):**
```typescript
              <ActivityBadge
                leadId={leadId}
                companyId={companyId}
                onActivityClick={handleOpenActivity}
              />
```

#### **Modificar ActivityBanner (linha ~1015):**
```typescript
        <ActivityBanner
          leadId={leadId}
          companyId={companyId}
          onViewDetails={handleOpenActivity}
        />
```

#### **Adicionar antes do último `</div>` do componente:**
```typescript
      {/* Modal de Atividade */}
      {showActivityModal && (
        <ActivityModal
          activity={selectedActivity}
          onClose={() => setShowActivityModal(false)}
          onSave={() => {
            setShowActivityModal(false)
            // Recarregar atividades
          }}
        />
      )}
```

---

## 🚀 DEPLOY

Após fazer as mudanças:

```bash
git add -A
git commit
# (editor abrirá - digite a mensagem e salve)
git push origin main
```

---

## ✅ RESULTADO ESPERADO

- ✅ Popover mostrará TODAS as atividades
- ✅ Click em qualquer atividade abrirá o modal
- ✅ Modal existente será reutilizado
- ✅ Sem quebrar nada

---

## 📊 DADOS TÉCNICOS

- **Lead ID Teste:** 161 (Marcio)
- **Company ID:** dcc99d3d-9def-4b93-aeb2-1a3be5f15413
- **Atividades Cadastradas:** 2 (1 atrasada, 1 futura)
- **Tabela:** lead_activities
- **API Endpoint:** /api/activities/lead/[leadId]
- **Variáveis Ambiente:** VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

---

## 📝 OBSERVAÇÕES

- Sistema não-destrutivo: não quebra funcionalidades existentes
- Modal reutiliza componente ActivityModal já implementado
- Interface mantém padrão visual do sistema
- Commits sem flag -m (apenas git commit)
