import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Company } from '../lib/supabase';
import {
  companySortKey,
  hasPlatformWideCompanyAccess,
  pathAfterCompanySwitch,
  shouldShowCompanySwitcher,
} from './companySwitcherLogic';

type CompanySwitcherProps = {
  variant: 'expanded' | 'collapsed';
  onAfterSwitch?: () => void;
};

function sortCompanies(companies: Company[]): Company[] {
  const byId = new Map<string, Company>();
  for (const company of companies) {
    if (company?.id) byId.set(company.id, company);
  }
  return [...byId.values()].sort((a, b) =>
    companySortKey(a.name || '').localeCompare(companySortKey(b.name || ''), 'pt-BR')
  );
}

export const CompanySwitcher: React.FC<CompanySwitcherProps> = ({
  variant,
  onAfterSwitch,
}) => {
  const { t } = useTranslation('layout');
  const navigate = useNavigate();
  const location = useLocation();
  const {
    company,
    availableCompanies,
    userRoles,
    isImpersonating,
    switchCompany,
  } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const companies = useMemo(
    () => sortCompanies(availableCompanies),
    [availableCompanies]
  );

  const showSwitcher = shouldShowCompanySwitcher({
    rolesLoaded: userRoles.length > 0,
    isImpersonating,
    hasPlatformWideAccess: hasPlatformWideCompanyAccess(userRoles),
    companyCount: companies.length,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectCompany = (companyId: string) => {
    setOpen(false);
    if (!companyId || companyId === company?.id) return;
    switchCompany(companyId);
    const nextPath = pathAfterCompanySwitch(location.pathname, location.search);
    if (nextPath) navigate(nextPath);
    onAfterSwitch?.();
  };

  if (!showSwitcher) {
    if (variant === 'collapsed') return null;
    return (
      <p className="text-xs font-medium text-slate-300 truncate">
        {company?.name}
      </p>
    );
  }

  const currentLabel = company?.name || t('companySwitcher.label');
  const triggerLabel = t('companySwitcher.changeAriaLabel', { name: currentLabel });

  const menu = open ? (
    <ul
      role="listbox"
      aria-label={t('companySwitcher.listAriaLabel')}
      className={
        variant === 'collapsed'
          ? 'absolute left-full bottom-0 z-[70] ml-2 w-56 max-h-48 overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-1.5 shadow-xl'
          : 'absolute bottom-full left-0 right-0 z-[70] mb-1 max-h-48 overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-1.5 shadow-xl'
      }
    >
      {companies.map((item) => {
        const selected = item.id === company?.id;
        return (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => selectCompany(item.id)}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-xs transition-colors ${
                selected
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-200 hover:bg-slate-700/80'
              }`}
            >
              <span className="flex-1 min-w-0 truncate">{item.name}</span>
              {selected && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ul>
  ) : null;

  if (variant === 'collapsed') {
    return (
      <div ref={rootRef} className="relative flex justify-center w-full">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`p-2 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
            open ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={t('companySwitcher.collapsedAriaLabel')}
          title={currentLabel}
        >
          <Building2 className="w-5 h-5" aria-hidden />
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`w-full flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
          open
            ? 'border-blue-500 bg-slate-700 text-white'
            : 'border-slate-600/90 bg-slate-900/40 text-slate-200 hover:border-slate-500 hover:bg-slate-700/80'
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <Building2 className="w-3.5 h-3.5 shrink-0 text-slate-300" aria-hidden />
        <span className="flex-1 min-w-0 font-medium truncate">{currentLabel}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden />
      </button>
      {menu}
    </div>
  );
};
