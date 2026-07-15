// =============================================================================
// src/components/Settings/__tests__/agentGroupingUtils.test.ts
//
// Testes unitários dos utilitários puros de agrupamento de mensagens.
//
// COBERTURA (21 casos):
//   TC-G01–TC-G10  initGroupingState
//   TC-G11–TC-G16  computeGroupingPayload
//   TC-G17–TC-G21  validateGroupingInput
//   TC-W01         Wizard: spread preserva message_grouping_window_s
//
// PRINCÍPIOS:
//   - Funções puras — sem renderização React, sem mocks de módulos externos.
//   - Cada caso é atômico e independente.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  initGroupingState,
  computeGroupingPayload,
  validateGroupingInput,
  GROUPING_WINDOW_MIN,
  GROUPING_WINDOW_MAX,
  GROUPING_WINDOW_DEFAULT,
} from '../agentGroupingUtils';

// =============================================================================
// Bloco 1: initGroupingState
// =============================================================================

describe('TC-G01–TC-G10: initGroupingState', () => {

  it('TC-G01 model_config vazio → toggle desligado, window = default', () => {
    const result = initGroupingState({});
    expect(result.enabled).toBe(false);
    expect(result.window).toBe(GROUPING_WINDOW_DEFAULT);
  });

  it('TC-G02 model_config null → toggle desligado, window = default', () => {
    const result = initGroupingState(null);
    expect(result.enabled).toBe(false);
    expect(result.window).toBe(GROUPING_WINDOW_DEFAULT);
  });

  it('TC-G03 model_config undefined → toggle desligado, window = default', () => {
    const result = initGroupingState(undefined);
    expect(result.enabled).toBe(false);
    expect(result.window).toBe(GROUPING_WINDOW_DEFAULT);
  });

  it('TC-G04 message_grouping_window_s ausente → toggle desligado', () => {
    const result = initGroupingState({ media_max_per_call: 1 });
    expect(result.enabled).toBe(false);
  });

  it('TC-G05 message_grouping_window_s = 0 → toggle desligado', () => {
    const result = initGroupingState({ message_grouping_window_s: 0 });
    expect(result.enabled).toBe(false);
    expect(result.window).toBe(GROUPING_WINDOW_DEFAULT);
  });

  it('TC-G06 message_grouping_window_s = 30 → toggle ligado, window = 30', () => {
    const result = initGroupingState({ message_grouping_window_s: 30 });
    expect(result.enabled).toBe(true);
    expect(result.window).toBe(30);
  });

  it('TC-G07 message_grouping_window_s = 1 (mínimo) → habilitado', () => {
    const result = initGroupingState({ message_grouping_window_s: 1 });
    expect(result.enabled).toBe(true);
    expect(result.window).toBe(1);
  });

  it('TC-G08 message_grouping_window_s = 120 (máximo) → habilitado', () => {
    const result = initGroupingState({ message_grouping_window_s: 120 });
    expect(result.enabled).toBe(true);
    expect(result.window).toBe(120);
  });

  it('TC-G09 message_grouping_window_s = 121 (fora do range) → toggle desligado', () => {
    const result = initGroupingState({ message_grouping_window_s: 121 });
    expect(result.enabled).toBe(false);
  });

  it('TC-G10 outros campos do model_config são ignorados na inicialização', () => {
    const result = initGroupingState({
      media_max_per_call:        3,
      editing_mode:              'advanced_manual',
      message_grouping_window_s: 45,
    });
    expect(result.enabled).toBe(true);
    expect(result.window).toBe(45);
  });
});

// =============================================================================
// Bloco 2: computeGroupingPayload
// =============================================================================

describe('TC-G11–TC-G16: computeGroupingPayload', () => {

  it('TC-G11 toggle desligado → retorna 0', () => {
    expect(computeGroupingPayload(false, 30)).toBe(0);
  });

  it('TC-G12 toggle desligado com qualquer window → retorna 0', () => {
    expect(computeGroupingPayload(false, 120)).toBe(0);
  });

  it('TC-G13 toggle ligado + window=30 → retorna 30', () => {
    expect(computeGroupingPayload(true, 30)).toBe(30);
  });

  it('TC-G14 toggle ligado + window=1 → retorna 1', () => {
    expect(computeGroupingPayload(true, 1)).toBe(1);
  });

  it('TC-G15 toggle ligado + window=120 → retorna 120', () => {
    expect(computeGroupingPayload(true, 120)).toBe(120);
  });

  it('TC-G16 preservar outros campos via spread não é responsabilidade desta função', () => {
    const existing = { media_max_per_call: 2, editing_mode: 'advanced_manual' };
    const merged = {
      ...existing,
      message_grouping_window_s: computeGroupingPayload(true, 60),
    };
    expect(merged.media_max_per_call).toBe(2);
    expect(merged.editing_mode).toBe('advanced_manual');
    expect(merged.message_grouping_window_s).toBe(60);
  });
});

// =============================================================================
// Bloco 3: validateGroupingInput
// =============================================================================

describe('TC-G17–TC-G21: validateGroupingInput', () => {

  it('TC-G17 toggle desligado → null (sempre válido)', () => {
    expect(validateGroupingInput(false, 0)).toBeNull();
    expect(validateGroupingInput(false, 999)).toBeNull();
  });

  it('TC-G18 toggle ligado + window=30 → null (válido)', () => {
    expect(validateGroupingInput(true, 30)).toBeNull();
  });

  it('TC-G19 toggle ligado + window=0 → erro (0 inválido quando ligado)', () => {
    const err = validateGroupingInput(true, 0);
    expect(err).not.toBeNull();
    expect(err).toMatch(new RegExp(String(GROUPING_WINDOW_MIN)));
  });

  it('TC-G20 toggle ligado + window=121 → erro (acima do máximo)', () => {
    const err = validateGroupingInput(true, 121);
    expect(err).not.toBeNull();
    expect(err).toMatch(new RegExp(String(GROUPING_WINDOW_MAX)));
  });

  it('TC-G21 toggle ligado + window=1 e window=120 → ambos válidos', () => {
    expect(validateGroupingInput(true, GROUPING_WINDOW_MIN)).toBeNull();
    expect(validateGroupingInput(true, GROUPING_WINDOW_MAX)).toBeNull();
  });
});

// =============================================================================
// Bloco 4: Wizard — spread preserva message_grouping_window_s
// =============================================================================

describe('TC-W01: PromptBuilderWizard spread preserva message_grouping_window_s', () => {

  it('TC-W01 spread de baseModelConfig preserva message_grouping_window_s', () => {
    // Replica exatamente o padrão usado no PromptBuilderWizard.handleSave:
    // const baseModelConfig = initialAgent?.model_config ?? {}
    // const modelConfigPayload = advancedManualActive
    //   ? { ...baseModelConfig, editing_mode: 'advanced_manual' }
    //   : baseModelConfig
    const initialModelConfig = {
      media_max_per_call:        2,
      message_grouping_window_s: 45,
    };

    const baseModelConfig = initialModelConfig ?? {};

    // Cenário A: modo avançado ativo (acrescenta editing_mode)
    const payloadAdvanced = { ...baseModelConfig, editing_mode: 'advanced_manual' };
    expect(payloadAdvanced.message_grouping_window_s).toBe(45);
    expect(payloadAdvanced.media_max_per_call).toBe(2);
    expect(payloadAdvanced.editing_mode).toBe('advanced_manual');

    // Cenário B: modo estruturado (usa baseModelConfig diretamente)
    const payloadStructured = baseModelConfig;
    expect(payloadStructured.message_grouping_window_s).toBe(45);
  });

  it('TC-W02 wizard sem message_grouping_window_s no agente original → campo ausente no payload', () => {
    const initialModelConfig = { media_max_per_call: 1 };
    const baseModelConfig = initialModelConfig ?? {};
    const payload = { ...baseModelConfig, editing_mode: 'advanced_manual' };
    expect(payload.message_grouping_window_s).toBeUndefined();
    expect(payload.media_max_per_call).toBe(1);
  });
});
