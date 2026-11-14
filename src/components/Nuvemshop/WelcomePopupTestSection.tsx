import { useState } from 'react';
import {
  EMAIL_FORMAT_MESSAGE,
  MOBILE_FORMAT_MESSAGE,
  formatNationalMobile,
  normalizeWelcomeEmail,
  normalizeWelcomeMobile,
  parseWelcomeContactList,
} from '../../../api/lib/nuvemshop/welcomeContact.js';
import { clearWelcomePopupTests, runWelcomePopupTest, type WelcomePopupTestResult } from '../../services/nuvemshopWelcomePopupApi';
import { WelcomeMobileField } from './WelcomeMobileField';

interface Contact {
  email: string;
  phone: string;
}

interface Props {
  companyId: string;
  storeId: string;
  canWrite: boolean;
  origins: string;
  contacts: Contact[];
  onOrigins: (value: string) => void;
  onContacts: (value: Contact[]) => void;
  onContactsIssue: (issue: string | null) => void;
}

const RESULT: Record<WelcomePopupTestResult['eligibility'], string> = {
  ineligible_paid: 'Compra paga encontrada no histórico sincronizado. O teste não concedeu o cupom.',
  eligible_limited: 'Nenhuma compra paga encontrada no histórico sincronizado. A verificação é limitada e o cupom não foi revelado.',
  unavailable: 'A leitura falhou. O teste não tratou essa falha como ausência de compra.',
  pending_refund_rule: 'Há reembolso no histórico. A regra ainda não foi decidida e não houve concessão.',
  payment_inconclusive: 'Há pedido sincronizado com pagamento inconclusivo. Isso não foi tratado como ausência de compra e o cupom não foi concedido.',
  not_evaluated: 'E-mail e WhatsApp apontam para cadastros diferentes. Nada foi mesclado nem criado.',
};

const IDENTITY: Record<WelcomePopupTestResult['identity'], string> = {
  none: 'Nenhum lead foi criado.',
  reuse: 'Usaria um cadastro existente, sem alterar os dados.',
  conflict: 'O conflito de identidade impediu o teste de seguir.',
  unavailable: 'A leitura dos cadastros falhou.',
};

const CONTACTS_MESSAGE = 'Cada contato autorizado precisa de e-mail e celular válidos. O formato não confirma que a caixa ou o WhatsApp existem.';

function displayContacts(contacts: Contact[]): string {
  return contacts.map((item) => {
    const national = item.phone.startsWith('55') && item.phone.length === 13
      ? formatNationalMobile(item.phone.slice(2))
      : item.phone;
    return `${item.email}, ${national}`;
  }).join('\n');
}

export function WelcomePopupTestSection({
  companyId,
  storeId,
  canWrite,
  origins,
  contacts,
  onOrigins,
  onContacts,
  onContactsIssue,
}: Props) {
  const [contactText, setContactText] = useState(displayContacts(contacts));
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [couponConsent, setCouponConsent] = useState(false);
  const [promoConsent, setPromoConsent] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function registerTest() {
    const normalizedEmail = normalizeWelcomeEmail(email);
    const normalizedPhone = normalizeWelcomeMobile(phone);
    setEmailError(normalizedEmail ? null : EMAIL_FORMAT_MESSAGE);
    setPhoneError(normalizedPhone ? null : MOBILE_FORMAT_MESSAGE);
    if (!normalizedEmail || !normalizedPhone || contactsError) {
      setPhase('error');
      setMessage(null);
      return;
    }
    setPhase('submitting');
    setMessage(null);
    try {
      const result = await runWelcomePopupTest(companyId, storeId, {
        name,
        email: normalizedEmail,
        phone: normalizedPhone,
        coupon_consent: couponConsent,
        promo_consent: promoConsent,
      });
      setPhase('success');
      const limitation = result.limitation ? ` ${result.limitation}` : '';
      setMessage(`${RESULT[result.eligibility]} ${IDENTITY[result.identity]}${limitation}`);
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Erro ao registrar o teste.');
    }
  }

  async function clearTests() {
    setPhase('submitting');
    setMessage(null);
    try {
      await clearWelcomePopupTests(companyId, storeId);
      setPhase('success');
      setMessage('Resultados de teste apagados. Nenhum lead ou cupom foi alterado.');
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Erro ao limpar os testes.');
    }
  }

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <p className="text-xs font-medium text-slate-700">Origens autorizadas</p>
      <textarea
        aria-label="Origens autorizadas"
        value={origins}
        disabled={!canWrite}
        placeholder="https://valleron.store"
        onChange={(event) => onOrigins(event.target.value)}
        className="h-16 w-full max-w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <p className="text-xs text-slate-500">
        Uma origem https por linha, sem caminho. O domínio antigo da conexão não é usado. Isso não publica o pop-up.
      </p>
      <p className="text-xs font-medium text-slate-700">Contatos autorizados para teste</p>
      <textarea
        aria-label="Contatos autorizados para teste"
        value={contactText}
        disabled={!canWrite}
        placeholder="nome.sobrenome+tag@dominio.com.br, (11) 99999-9999"
        onChange={(event) => {
          const value = event.target.value;
          setContactText(value);
          if (!value.trim()) {
            setContactsError(null);
            onContactsIssue(null);
            onContacts([]);
            return;
          }
          const parsed = parseWelcomeContactList(value);
          if (!parsed.ok) {
            setContactsError(CONTACTS_MESSAGE);
            onContactsIssue(CONTACTS_MESSAGE);
            return;
          }
          setContactsError(null);
          onContactsIssue(null);
          onContacts(parsed.contacts);
        }}
        className="h-16 w-full max-w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      {contactsError && <span className="block text-xs text-red-600">{contactsError}</span>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input aria-label="Nome do teste" value={name} disabled={!canWrite} placeholder="Nome" onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <div className="min-w-0">
          <input
            type="email"
            aria-label="E-mail do teste"
            aria-invalid={emailError ? true : undefined}
            value={email}
            disabled={!canWrite}
            placeholder="nome@dominio.com.br"
            onChange={(event) => { setEmail(event.target.value); setEmailError(null); }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          {emailError && <span className="mt-1 block text-xs text-red-600">{emailError}</span>}
        </div>
        <WelcomeMobileField
          value={phone}
          disabled={!canWrite}
          error={phoneError}
          onChange={(value) => { setPhone(value); setPhoneError(null); }}
        />
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={couponConsent} disabled={!canWrite} onChange={(event) => setCouponConsent(event.target.checked)} />
        Aceite obrigatório para receber o cupom neste teste.
      </label>
      <label className="flex items-start gap-2 text-xs text-slate-700">
        <input aria-label="Aceite opcional de promoções no teste" type="checkbox" checked={promoConsent} disabled={!canWrite} onChange={(event) => setPromoConsent(event.target.checked)} />
        Aceite opcional para promoções futuras. Não é necessário para o cupom.
      </label>
      {message && (
        <div role={phase === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-2.5 text-sm ${phase === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          {message}
        </div>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={registerTest} disabled={phase === 'submitting'} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 disabled:opacity-60">
            {phase === 'submitting' ? 'Registrando…' : 'Registrar teste'}
          </button>
          <button type="button" onClick={clearTests} disabled={phase === 'submitting'} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 disabled:opacity-60">
            Limpar resultados de teste
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        O teste não revela o cupom, não redireciona, não cria lead e não entra em automação. A limpeza apaga só estes resultados.
      </p>
    </div>
  );
}
