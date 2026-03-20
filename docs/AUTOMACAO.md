# Sistema de Automação - LovooCRM

## Arquitetura
- FlowEditor: Editor visual
- AutomationEngine: Execução
- TriggerManager: Gatilhos
- NodeConfigPanel: Configuração

## 17 Ações Implementadas

### Lead (4)
- add_tag, remove_tag, update_lead, set_custom_field

### Oportunidade (5)
- create_opportunity, move_opportunity, win_opportunity, lose_opportunity, assign_owner

### Atividade (5)
- create_activity, update_activity, complete_activity, cancel_activity, reschedule_activity

### Sistema (2)
- send_notification, trigger_automation

### Integração (1)
- send_webhook

## 11 Triggers
lead.created, message.received, opportunity.created, opportunity.stage_changed, opportunity.won, opportunity.lost, opportunity.owner_assigned, opportunity.owner_removed, tag.added, tag.removed, schedule.time

## Exemplo de Uso
Trigger: lead.created → Ação: add_tag → Ação: send_notification → Ação: trigger_automation
