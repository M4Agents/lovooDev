const LINEAR_HANDLES = new Set(['trigger-output', 'next']);
const WHATSAPP_TYPES = new Set(['text', 'audio', 'file', 'dynamic_url']);

function nodeConfig(node) {
  const config = node?.data?.config;
  return config && typeof config === 'object' ? config : {};
}

function popupTrigger(flow) {
  const start = (flow?.nodes ?? []).find((node) => node.type === 'start')
    ?? (flow?.nodes ?? []).find((node) => node.type === 'trigger');
  const trigger = (start?.data?.triggers ?? []).find((item) => (
    item?.enabled && item.type === 'nuvemshop.popup_signup'
  ));
  return { start, trigger };
}

function continuesStraight(node) {
  if (!node) return false;
  if (node.type === 'start' || node.type === 'trigger') return true;
  if (node.type !== 'delay') return false;
  return nodeConfig(node).wait_mode !== 'time_or_response';
}

function whatsappInstance(node, trigger) {
  const own = String(nodeConfig(node).instanceId ?? '').trim();
  const fromTrigger = String(trigger?.config?.instanceId ?? '').trim();
  return own || fromTrigger;
}

function enabledWhatsappSend(node, trigger) {
  if (node?.type !== 'message') return false;
  if (node.data?.enabled === false || node.data?.disabled === true) return false;
  const config = nodeConfig(node);
  if (config.enabled === false || config.messageType === 'user_input' || config.channel === 'instagram') return false;
  if (config.messageType && !WHATSAPP_TYPES.has(config.messageType)) return false;
  return whatsappInstance(node, trigger).length > 0;
}

export function flowHasCertainWhatsappSend(flow) {
  const { start, trigger } = popupTrigger(flow);
  if (!start || !trigger) return false;
  const nodes = new Map((flow.nodes ?? []).map((node) => [node.id, node]));
  const seen = new Set();
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    if (enabledWhatsappSend(node, trigger)) return true;
    if (node !== start && !continuesStraight(node)) continue;
    for (const edge of flow.edges ?? []) {
      if (edge?.source === id && LINEAR_HANDLES.has(edge.sourceHandle)) queue.push(edge.target);
    }
  }
  return false;
}
