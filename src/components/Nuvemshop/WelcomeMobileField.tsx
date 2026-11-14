import { useLayoutEffect, useRef, type ChangeEvent } from 'react';
import {
  caretFromDigitCount,
  collapseMobileDigits,
  digitsBeforeCaret,
  formatNationalMobile,
} from '../../../api/lib/nuvemshop/welcomeContact.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string | null;
}

export function WelcomeMobileField({ value, onChange, disabled = false, error = null }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = caretRef.current;
    if (!input || caret == null) return;
    caretRef.current = null;
    input.setSelectionRange(caret, caret);
  }, [value]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const caret = input.selectionStart ?? input.value.length;
    const before = digitsBeforeCaret(input.value, caret);
    const digits = input.value.replace(/\D/g, '');
    const removed = digits.length === 13 && digits.startsWith('55') ? 2 : 0;
    const national = collapseMobileDigits(digits);
    const formatted = formatNationalMobile(national);
    caretRef.current = caretFromDigitCount(formatted, Math.max(0, before - removed));
    onChange(formatted);
  }

  return (
    <div className="min-w-0">
      <div
        data-mobile-row
        className="flex h-9 min-w-0 max-w-full items-center overflow-hidden rounded-lg border border-slate-200"
      >
        <span data-country-prefix className="shrink-0 select-none px-2 text-sm text-slate-500">+55</span>
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          aria-label="WhatsApp do teste"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'welcome-mobile-error' : undefined}
          value={value}
          disabled={disabled}
          placeholder="(11) 99999-9999"
          onChange={handleChange}
          className="min-w-0 flex-1 bg-transparent py-2 pr-2 text-sm outline-none disabled:bg-slate-50"
        />
      </div>
      {error && (
        <span id="welcome-mobile-error" className="mt-1 block text-xs font-normal text-red-600">{error}</span>
      )}
    </div>
  );
}
