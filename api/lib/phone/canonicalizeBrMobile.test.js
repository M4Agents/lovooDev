/**
 * Smoke tests locais do helper canônico BR.
 * Executar: node api/lib/phone/canonicalizeBrMobile.test.js
 */
import { brMobilePhoneLookupValues, canonicalizeBrMobilePhone } from './canonicalizeBrMobile.js';

const cases = [
  // Caso Valleron
  ['554791848974', '5547991848974', 'sem 9 → insere 9'],
  ['5547991848974', '5547991848974', 'já canônico → mantém'],
  ['4791848974', '5547991848974', '10 dígitos nacionais → 55 + 9'],
  ['47991848974', '5547991848974', '11 dígitos nacionais → 55'],
  ['(47) 99184-8974', '5547991848974', 'formatado com 9'],
  ['(47) 9184-8974', '5547991848974', 'formatado sem 9'],

  // Fixo BR (não inserir 9)
  ['554733331234', '554733331234', 'fixo 12 dígitos → sem 9'],
  ['4733331234', '554733331234', 'fixo 10 dígitos → 55 sem 9'],

  // Assinante começando com 5 (não móvel clássico) → sem forçar 9
  ['554751234567', '554751234567', 'assinante 5xxx → sem 9'],

  // Internacional com 12+ dígitos: só dígitos (sem forçar 9)
  ['141555526712', '141555526712', 'internacional 12+ → só dígitos'],
  // 10/11 dígitos são tratados como nacionais BR (regra do plano)
  ['14155552671', '5514155552671', '11 dígitos → prefixa 55 (heurística BR)'],

  // Edge
  [null, null, 'null'],
  ['', null, 'vazio'],
  ['abc', null, 'sem dígitos'],
];

let failed = 0;
for (const [input, expected, label] of cases) {
  const got = canonicalizeBrMobilePhone(input);
  const ok = got === expected;
  if (!ok) {
    failed += 1;
    console.error(`FAIL: ${label} | input=${JSON.stringify(input)} expected=${expected} got=${got}`);
  } else {
    console.log(`OK:   ${label}`);
  }
}

// Paridade Valleron: com e sem 9 colidem no mesmo canônico
const a = canonicalizeBrMobilePhone('554791848974');
const b = canonicalizeBrMobilePhone('5547991848974');
if (a !== b || a !== '5547991848974') {
  failed += 1;
  console.error('FAIL: paridade Valleron', { a, b });
} else {
  console.log('OK:   paridade Valleron 11738/11739');
}

const lookup = brMobilePhoneLookupValues('558288956767').sort();
const expectedLookup = ['558288956767', '5582988956767', '82988956767'].sort();
if (lookup.join() !== expectedLookup.join()) {
  failed += 1;
  console.error('FAIL: lookup sem 9', { lookup, expectedLookup });
} else {
  console.log('OK:   lookup sem 9 inclui o canônico com 9');
}

if (failed > 0) {
  console.error(`\n${failed} falha(s)`);
  process.exit(1);
}

console.log(`\nTodos os ${cases.length + 2} checks passaram.`);
