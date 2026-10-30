export const META_APPS_URL = 'https://developers.facebook.com/apps/';
export const META_BUSINESS_URL = 'https://business.facebook.com/settings/';

const key = (suffix: string) => `integrations.instagramByo.guide.${suffix}`;

export type GuideBlock =
  | { kind: 'p'; key: string }
  | { kind: 'h'; key: string }
  | { kind: 'ol' | 'ul'; keys: string[] }
  | { kind: 'warn'; key: string }
  | { kind: 'link'; key: string; href: string };

export type GuideStep = { title: string; blocks: GuideBlock[] };

function p(suffix: string): GuideBlock {
  return { kind: 'p', key: key(suffix) };
}

function h(suffix: string): GuideBlock {
  return { kind: 'h', key: key(suffix) };
}

function ol(suffixes: string[]): GuideBlock {
  return { kind: 'ol', keys: suffixes.map(key) };
}

function ul(suffixes: string[]): GuideBlock {
  return { kind: 'ul', keys: suffixes.map(key) };
}

function warn(suffix: string): GuideBlock {
  return { kind: 'warn', key: key(suffix) };
}

function link(suffix: string, href: string): GuideBlock {
  return { kind: 'link', key: key(suffix), href };
}

export const BYO_GUIDE_STEPS: GuideStep[] = [
  { title: key('s1.title'), blocks: [ul(['s1.i1', 's1.i2', 's1.i3', 's1.i4', 's1.i5'])] },
  {
    title: key('s2.title'),
    blocks: [
      link('s2.link', META_APPS_URL),
      ol(['s2.i1', 's2.i2', 's2.i3', 's2.i4', 's2.i5', 's2.i6']),
      p('s2.note'),
    ],
  },
  {
    title: key('s3.title'),
    blocks: [ol(['s3.i1', 's3.i2', 's3.i3', 's3.i4']), warn('s3.warn'), p('s3.note')],
  },
  {
    title: key('s4.title'),
    blocks: [p('s4.lead'), p('s4.scopes'), p('s4.note'), warn('s4.warn')],
  },
  {
    title: key('s5.title'),
    blocks: [link('s5.link', META_BUSINESS_URL), ol(['s5.i1', 's5.i2', 's5.i3', 's5.i4'])],
  },
  {
    title: key('s6.title'),
    blocks: [ol(['s6.i1', 's6.i2', 's6.i3', 's6.i4', 's6.i5']), p('s6.note')],
  },
  {
    title: key('s7.title'),
    blocks: [ol(['s7.i1', 's7.i2', 's7.i3', 's7.i4', 's7.i5', 's7.i6']), warn('s7.w1'), warn('s7.w2'), warn('s7.w3')],
  },
  {
    title: key('s8.title'),
    blocks: [p('s8.lead'), ul(['s8.i1', 's8.i2', 's8.i3']), p('s8.note')],
  },
  {
    title: key('s9.title'),
    blocks: [ol(['s9.i1', 's9.i2', 's9.i3', 's9.i4']), p('s9.note')],
  },
  {
    title: key('s10.title'),
    blocks: [ol(['s10.i1', 's10.i2', 's10.i3', 's10.i4']), p('s10.note'), warn('s10.warn')],
  },
  {
    title: key('s11.title'),
    blocks: [ul(['s11.i1', 's11.i2', 's11.i3', 's11.i4']), warn('s11.warn')],
  },
  {
    title: key('s12.title'),
    blocks: [
      h('s12.aTitle'), ul(['s12.a1', 's12.a2', 's12.a3']), warn('s12.aNote'),
      h('s12.bTitle'), ul(['s12.b1', 's12.b2']),
      h('s12.cTitle'), ul(['s12.c1', 's12.c2', 's12.c3']),
      h('s12.dTitle'), p('s12.d1'),
      h('s12.eTitle'), p('s12.e1'),
    ],
  },
];
