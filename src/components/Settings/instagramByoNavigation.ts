const BYO_INTEGRATION = 'instagram-byo';

export function openInstagramByoSearchParams(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('tab', 'integracoes');
  next.set('integration', BYO_INTEGRATION);
  return next;
}

/**
 * Remove só integration=instagram-byo depois que a prévia já foi exibida.
 * integration=instagram, nuvemshop, openai e elevenlabs permanecem.
 * Devolve null quando a URL não deve mudar.
 */
export function leaveInstagramByoSearchParams(
  current: URLSearchParams,
  destination: { activeTab: string; integracoesTab: string },
  byoWasShown: boolean,
): URLSearchParams | null {
  if (current.get('integration') !== BYO_INTEGRATION) return null;
  if (!byoWasShown) return null;
  if (destination.activeTab === 'integracoes' && destination.integracoesTab === BYO_INTEGRATION) return null;

  const next = new URLSearchParams(current);
  next.delete('integration');
  if (destination.activeTab !== 'integracoes') {
    next.set('tab', destination.activeTab);
  }
  return next;
}
