import type { CSSProperties } from 'react';

export interface WelcomePopupPreviewContent {
  title: string;
  description: string;
  imageUrl: string | null;
  buttonLabel: string;
  consentText: string;
  backgroundColor: string;
  textColor: string;
  buttonColor: string;
}

const FALLBACK = {
  title: 'Bem-vindo',
  description: 'Deixe seus dados para receber o cupom desta loja.',
  buttonLabel: 'Quero participar',
  consentText: 'Autorizo o uso dos meus dados para receber o cupom.',
  backgroundColor: '#ffffff',
  textColor: '#0f172a',
  buttonColor: '#6d28d9',
};

const HEX = /^#[0-9a-f]{6}$/i;

export function safeHex(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return HEX.test(trimmed) ? trimmed : fallback;
}

export function safePreviewImage(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function previewFrameStyle(viewport: 'desktop' | 'mobile'): CSSProperties {
  return {
    width: '100%',
    maxWidth: viewport === 'mobile' ? 220 : 420,
    minWidth: 0,
    boxSizing: 'border-box',
  };
}

export function previewModalStyle(content: WelcomePopupPreviewContent): CSSProperties {
  return {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    background: safeHex(content.backgroundColor, FALLBACK.backgroundColor),
    color: safeHex(content.textColor, FALLBACK.textColor),
  };
}

export function previewButtonStyle(content: WelcomePopupPreviewContent): CSSProperties {
  return {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    whiteSpace: 'normal',
    background: safeHex(content.buttonColor, FALLBACK.buttonColor),
    color: '#ffffff',
  };
}

export function WelcomePopupPreview({
  viewport,
  content,
}: {
  viewport: 'desktop' | 'mobile';
  content: WelcomePopupPreviewContent;
}) {
  const image = safePreviewImage(content.imageUrl);
  const title = content.title.trim() || FALLBACK.title;
  const description = content.description.trim() || FALLBACK.description;
  const button = content.buttonLabel.trim() || FALLBACK.buttonLabel;
  const consent = content.consentText.trim() || FALLBACK.consentText;

  return (
    <div style={previewFrameStyle(viewport)} data-viewport={viewport} className="mx-auto">
      <div
        data-preview-modal
        style={previewModalStyle(content)}
        className="rounded-2xl border border-slate-200 p-3 shadow-sm"
      >
        {image && (
          <img
            src={image}
            alt=""
            className="mb-3 block h-24 w-full max-w-full rounded-lg object-cover"
          />
        )}
        <p className="text-base font-semibold leading-snug">{title}</p>
        <p className="mt-1 text-sm leading-snug opacity-80">{description}</p>
        <div className="mt-3 min-w-0 space-y-2">
          {['Nome', 'E-mail', 'WhatsApp'].map((label) => (
            <div key={label} className="min-w-0 max-w-full">
              <span className="mb-1 block text-[11px] font-medium">{label}</span>
              <div className="h-8 w-full max-w-full rounded-lg border border-black/10 bg-white/80" />
            </div>
          ))}
          <p className="text-[11px] leading-snug opacity-80">{consent}</p>
          <div
            data-preview-button
            style={previewButtonStyle(content)}
            className="rounded-lg px-3 py-2 text-center text-sm font-medium"
          >
            {button}
          </div>
        </div>
      </div>
    </div>
  );
}
