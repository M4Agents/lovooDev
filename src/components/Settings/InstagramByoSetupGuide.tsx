import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, X } from 'lucide-react';
import { BYO_GUIDE_STEPS, type GuideBlock } from './instagramByoSetupGuideModel';

function GuideBlocks({ blocks }: { blocks: GuideBlock[] }) {
  const { t } = useTranslation('settings.app');
  return (
    <div className="space-y-3 text-sm text-slate-700">
      {blocks.map((block) => {
        if (block.kind === 'ol' || block.kind === 'ul') {
          const ListTag = block.kind === 'ol' ? 'ol' : 'ul';
          const marker = block.kind === 'ol' ? 'list-decimal' : 'list-disc';
          return (
            <ListTag key={block.keys[0]} className={`${marker} space-y-1 pl-5`}>
              {block.keys.map((item) => <li key={item}>{t(item)}</li>)}
            </ListTag>
          );
        }
        if (block.kind === 'warn') {
          return (
            <p key={block.key} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              {t(block.key)}
            </p>
          );
        }
        if (block.kind === 'link') {
          return (
            <a
              key={block.href}
              href={block.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm font-medium text-blue-700 underline"
            >
              {t(block.key)}
            </a>
          );
        }
        if (block.kind === 'h') {
          return <p key={block.key} className="pt-1 font-medium text-slate-900">{t(block.key)}</p>;
        }
        return <p key={block.key}>{t(block.key)}</p>;
      })}
    </div>
  );
}

export function InstagramByoSetupGuide() {
  const { t } = useTranslation('settings.app');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const step = BYO_GUIDE_STEPS[index];
  const last = index === BYO_GUIDE_STEPS.length - 1;

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setIndex(0);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
      >
        <BookOpen className="h-4 w-4" aria-hidden="true" />
        {t('integrations.instagramByo.guide.open')}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="instagram-byo-guide-title"
            data-testid="instagram-byo-setup-guide"
            className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:max-h-[85vh] sm:rounded-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div>
                <p className="text-xs font-medium text-slate-500">{index + 1} / {BYO_GUIDE_STEPS.length}</p>
                <h2 id="instagram-byo-guide-title" className="text-base font-semibold text-slate-900 sm:text-lg">
                  {t('integrations.instagramByo.guide.title')}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{t('integrations.instagramByo.guide.subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={t('integrations.instagramByo.guide.close')}
                className="rounded-lg p-1 text-slate-400"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
              <h3 className="text-sm font-semibold text-slate-900">{index + 1}. {t(step.title)}</h3>
              <GuideBlocks blocks={step.blocks} />
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setIndex((current) => current - 1)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-40"
              >
                {t('integrations.instagramByo.guide.previous')}
              </button>
              <button
                type="button"
                disabled={last}
                onClick={() => setIndex((current) => current + 1)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {t('integrations.instagramByo.guide.next')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
