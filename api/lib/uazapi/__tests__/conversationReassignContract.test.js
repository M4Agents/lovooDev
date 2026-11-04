import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');

function source(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function reassign(state, next) {
  if (!next.phone) return state;
  const moved = state.conversations.map((conversation) => ({ ...conversation }));
  const deleted = state.instances.filter((instance) => (
    instance.companyId === next.companyId
    && instance.phone === next.phone
    && instance.deletedAt
    && instance.id !== next.id
  ));
  for (const old of deleted) {
    for (const conversation of moved) {
      const pointsAtOld = conversation.instanceId === old.id || conversation.lastInstanceId === old.id;
      const alreadyOnNext = moved.some((other) => (
        other.companyId === next.companyId
        && other.instanceId === next.id
        && other.phone === conversation.phone
      ));
      if (pointsAtOld && !alreadyOnNext && conversation.companyId === next.companyId) {
        conversation.instanceId = next.id;
        conversation.lastInstanceId = next.id;
        conversation.lastInstanceName = next.name;
      }
    }
  }
  return { ...state, conversations: moved };
}

function onInsert(state, instance) {
  return reassign({ ...state, instances: [...state.instances, instance] }, instance);
}

function onPhoneSet(state, before, after) {
  if (before.phone || !after.phone || after.deletedAt) return state;
  return reassign(state, after);
}

function receive(state, input) {
  const existing = state.conversations.find((conversation) => (
    conversation.companyId === input.companyId
    && conversation.phone === input.phone
    && conversation.status === 'active'
  ));
  const conversations = existing
    ? state.conversations
    : [...state.conversations, {
      id: `conv-${input.messageId}`,
      companyId: input.companyId,
      instanceId: input.instanceId,
      lastInstanceId: input.instanceId,
      phone: input.phone,
      assignedTo: input.assignedTo ?? null,
      status: 'active',
    }];
  const conversation = existing ?? conversations[conversations.length - 1];
  return {
    ...state,
    conversations,
    messages: [...state.messages, {
      id: input.messageId,
      conversationId: conversation.id,
      instanceId: input.instanceId,
      companyId: input.companyId,
    }],
  };
}

function sendInstanceId(state, conversationId) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  const instance = state.instances.find((item) => item.id === conversation?.instanceId);
  if (!instance || instance.deletedAt || instance.status !== 'connected') return null;
  return instance.id;
}

const COMPANY = 'company-a';
const OTHER = 'company-b';
const OLD = 'instance-old';
const NEXT = 'instance-next';
const PHONE = '5511999990000';

function base() {
  return {
    instances: [{
      id: OLD,
      companyId: COMPANY,
      name: 'Antiga',
      phone: PHONE,
      status: 'disconnected',
      deletedAt: '2026-11-01',
    }],
    conversations: [{
      id: 'conv-1',
      companyId: COMPANY,
      instanceId: OLD,
      lastInstanceId: OLD,
      phone: PHONE,
      assignedTo: 'seller-1',
      status: 'active',
    }, {
      id: 'conv-other',
      companyId: OTHER,
      instanceId: 'foreign',
      lastInstanceId: 'foreign',
      phone: PHONE,
      assignedTo: 'seller-2',
      status: 'active',
    }],
    messages: [{
      id: 'msg-old',
      conversationId: 'conv-1',
      instanceId: OLD,
      companyId: COMPANY,
    }],
  };
}

describe('contrato da realocação existente', () => {
  it('mantém o gatilho e a confirmação fora do endpoint novo de QR', () => {
    const qr = source('api/lib/uazapi/qrSession.js');
    const drop = source('supabase/migrations/20261104140000_retire_uazapi_admin_from_qr_sql.sql');
    const confirm = source('supabase/migrations/20261019110000_assign_seller_on_whatsapp_connect.sql');
    const trigger = source('supabase/migrations/20261013144907_reassign_automation_instance_on_reconnect.sql');
    const phoneTrigger = source('supabase/migrations/20260731140000_fix_trigger_reassign_conversations_on_phone_set.sql');
    expect(qr).not.toContain('chat_conversations');
    expect(qr).not.toContain('chat_messages');
    expect(qr).toContain('uazapi_token');
    expect(qr).toContain('uazapi_name');
    expect(drop).not.toContain('reassign_conversations_on_instance_reconnect');
    expect(drop).not.toContain('check_instance_connection_status');
    expect(confirm).toContain('INSERT INTO whatsapp_life_instances');
    expect(confirm).toContain('phone_number');
    expect(confirm).toContain('ON CONFLICT (company_id, instance_name)');
    expect(trigger).toContain('UPDATE chat_conversations');
    expect(trigger).not.toContain('UPDATE chat_messages');
    expect(trigger).toContain('cc2.company_id');
    expect(trigger).toContain('NEW.company_id');
    expect(phoneTrigger).toContain('AFTER UPDATE OF phone_number');
    expect(phoneTrigger).toContain('OLD.phone_number IS NULL');
  });

  it('o hook da tela continua usando a RPC que grava a instância permanente', () => {
    const hook = source('src/hooks/useWhatsAppInstances_webhook100.ts');
    expect(hook).toContain("supabase.rpc('check_instance_connection_status'");
    expect(hook).toContain('requestWhatsAppQrSession(companyId, name, tempInstanceId)');
    expect(hook).not.toContain('chat_conversations');
    expect(hook).not.toContain('chat_messages');
  });

  it('associa a conversa à instância nova e preserva a mensagem antiga', () => {
    const connected = onInsert(base(), {
      id: NEXT,
      companyId: COMPANY,
      name: 'Nova',
      phone: PHONE,
      status: 'connected',
      deletedAt: null,
    });
    expect(connected.conversations.find((item) => item.id === 'conv-1')).toMatchObject({
      instanceId: NEXT,
      lastInstanceId: NEXT,
      lastInstanceName: 'Nova',
      assignedTo: 'seller-1',
    });
    expect(connected.messages).toEqual(base().messages);
    const after = receive(connected, {
      companyId: COMPANY,
      instanceId: NEXT,
      phone: PHONE,
      messageId: 'msg-new',
      assignedTo: 'seller-1',
    });
    expect(after.conversations.filter((item) => item.companyId === COMPANY && item.phone === PHONE)).toHaveLength(1);
    expect(after.messages.find((item) => item.id === 'msg-new').instanceId).toBe(NEXT);
    expect(after.messages.find((item) => item.id === 'msg-old').instanceId).toBe(OLD);
    expect(sendInstanceId(after, 'conv-1')).toBe(NEXT);
  });

  it('reconecta a mesma instância sem mover conversa nem mensagem', () => {
    const state = {
      instances: [{
        id: NEXT,
        companyId: COMPANY,
        name: 'Nova',
        phone: PHONE,
        status: 'disconnected',
        deletedAt: null,
      }],
      conversations: [{
        id: 'conv-1',
        companyId: COMPANY,
        instanceId: NEXT,
        lastInstanceId: NEXT,
        phone: PHONE,
        assignedTo: 'seller-1',
        status: 'active',
      }],
      messages: [{ id: 'msg-old', conversationId: 'conv-1', instanceId: NEXT, companyId: COMPANY }],
    };
    const before = state.instances[0];
    const after = { ...before, status: 'connected' };
    const next = onPhoneSet(state, before, after);
    expect(next.conversations).toEqual(state.conversations);
    expect(next.messages).toEqual(state.messages);
    expect(sendInstanceId({ ...next, instances: [after] }, 'conv-1')).toBe(NEXT);
  });

  it('não realoca outra empresa e não duplica o contato', () => {
    const seeded = base();
    seeded.conversations.push({
      id: 'conv-existing',
      companyId: COMPANY,
      instanceId: NEXT,
      lastInstanceId: NEXT,
      phone: PHONE,
      assignedTo: 'seller-1',
      status: 'active',
    });
    const connected = onInsert(seeded, {
      id: NEXT,
      companyId: COMPANY,
      name: 'Nova',
      phone: PHONE,
      status: 'connected',
      deletedAt: null,
    });
    expect(connected.conversations.find((item) => item.id === 'conv-1').instanceId).toBe(OLD);
    expect(connected.conversations.find((item) => item.id === 'conv-other')).toMatchObject({
      companyId: OTHER,
      instanceId: 'foreign',
    });
    expect(connected.conversations.filter((item) => item.phone === PHONE && item.instanceId === NEXT)).toHaveLength(1);
  });
});
