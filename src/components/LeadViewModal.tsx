import React, { useEffect, useState } from 'react';
import {
  X,
  User,
  Mail,
  Phone,
  Building2,
  FileText,
  Calendar,
  ExternalLink,
  MapPin,
  Instagram,
  Linkedin,
  Briefcase,
  Megaphone,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Globe,
  Hash,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { chatApi } from '../services/chat/chatApi';

interface Lead {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  origin: string;
  status: string;
  interest?: string;
  responsible_user_id?: string;
  visitor_id?: string;
  record_type?: string;
  created_at: string;
  updated_at: string;
  last_contact_at?: string;
  is_over_plan?: boolean;
  // Empresa
  company_name?: string;
  company_cnpj?: string;
  company_razao_social?: string;
  company_nome_fantasia?: string;
  company_email?: string;
  company_telefone?: string;
  company_site?: string;
  company_cep?: string;
  company_cidade?: string;
  company_estado?: string;
  company_endereco?: string;
  // Endereço pessoal
  cep?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  cidade?: string;
  estado?: string;
  // Perfil
  cargo?: string;
  poder_investimento?: string;
  data_nascimento?: string;
  instagram?: string;
  linkedin?: string;
  tiktok?: string;
  // Marketing
  campanha?: string;
  conjunto_anuncio?: string;
  anuncio?: string;
  // Custom fields
  lead_custom_values?: Array<{
    field_id: string;
    value: string;
    lead_custom_fields: {
      field_name: string;
      field_label: string;
      field_type: string;
    };
  }>;
}

interface CompanyUser {
  id?: string;
  user_id?: string;
  display_name?: string;
  email?: string;
}

interface LeadViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onEdit: (lead: Lead) => void;
  companyUsers?: CompanyUser[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const InfoRow: React.FC<{
  icon?: React.ReactNode;
  label: string;
  value?: string | null;
  href?: string;
  mono?: boolean;
}> = ({ icon, label, value, href, mono }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 min-w-0">
      {icon && <div className="mt-0.5 shrink-0 text-slate-400">{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        {href ? (
          <a
            href={href}
            target={href.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className={`font-medium text-blue-600 hover:text-blue-800 break-all transition-colors ${mono ? 'font-mono text-sm' : ''}`}
          >
            {value}
          </a>
        ) : (
          <p className={`font-medium text-slate-900 break-words ${mono ? 'font-mono text-sm' : ''}`}>{value}</p>
        )}
      </div>
    </div>
  );
};

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}> = ({ title, icon, children, collapsible = false, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 bg-slate-50 ${collapsible ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'} transition-colors`}
      >
        <div className="flex items-center gap-2 text-slate-700">
          <span className="text-slate-500">{icon}</span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {collapsible && (
          open
            ? <ChevronUp className="w-4 h-4 text-slate-400" />
            : <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {children}
        </div>
      )}
    </div>
  );
};

// ─── formatters ──────────────────────────────────────────────────────────────

const getStatusConfig = (status: string) => {
  switch (status) {
    case 'novo':            return { label: 'Novo',            cls: 'bg-blue-100 text-blue-800' };
    case 'em_qualificacao': return { label: 'Em Qualificação', cls: 'bg-yellow-100 text-yellow-800' };
    case 'convertido':      return { label: 'Convertido',      cls: 'bg-green-100 text-green-800' };
    case 'perdido':         return { label: 'Perdido',         cls: 'bg-red-100 text-red-800' };
    default:                return { label: status,            cls: 'bg-slate-100 text-slate-700' };
  }
};

const getOriginConfig = (origin: string) => {
  switch (origin) {
    case 'landing_page':          return { label: 'Landing Page', cls: 'bg-purple-100 text-purple-800' };
    case 'whatsapp':              return { label: 'WhatsApp',     cls: 'bg-green-100 text-green-800' };
    case 'manual':                return { label: 'Manual',       cls: 'bg-blue-100 text-blue-800' };
    case 'import':                return { label: 'Importação',   cls: 'bg-orange-100 text-orange-800' };
    case 'api':                   return { label: 'API Externa',  cls: 'bg-indigo-100 text-indigo-800' };
    case 'webhook_ultra_simples': return { label: 'Webhook',      cls: 'bg-teal-100 text-teal-800' };
    default:                      return { label: origin,         cls: 'bg-slate-100 text-slate-700' };
  }
};

const formatDateTime = (s?: string | null) => {
  if (!s) return undefined;
  return new Date(s).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const formatDate = (s?: string | null) => {
  if (!s) return undefined;
  return new Date(s).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
};

const buildAddress = (lead: Lead) => {
  const parts = [
    lead.endereco,
    lead.numero ? `nº ${lead.numero}` : null,
    lead.complemento,
    lead.bairro,
    lead.cidade,
    lead.estado,
    lead.cep,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
};

const buildCompanyAddress = (lead: Lead) => {
  const parts = [
    lead.company_endereco,
    lead.company_cidade,
    lead.company_estado,
    lead.company_cep,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
};

// ─── component ───────────────────────────────────────────────────────────────

export const LeadViewModal: React.FC<LeadViewModalProps> = ({
  isOpen,
  onClose,
  lead,
  onEdit,
  companyUsers = [],
}) => {
  const { company } = useAuth();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadPhoto = async () => {
      try {
        if (!company?.id || !lead?.phone || lead?.is_over_plan) {
          setPhotoUrl(null);
          return;
        }
        const phoneDigits = lead.phone.replace(/\D/g, '');
        if (!phoneDigits) { setPhotoUrl(null); return; }
        const contact = await chatApi.getContactInfo(company.id, phoneDigits);
        setPhotoUrl(contact?.profile_picture_url || null);
      } catch {
        setPhotoUrl(null);
      }
    };
    if (isOpen && lead) loadPhoto();
    else setPhotoUrl(null);
  }, [isOpen, lead, company?.id]);

  if (!isOpen || !lead) return null;

  const status  = getStatusConfig(lead.status);
  const origin  = getOriginConfig(lead.origin);
  const phoneDigits = lead.phone?.replace(/\D/g, '') ?? '';
  const responsible = companyUsers.find(
    u => (u.user_id ?? u.id) === lead.responsible_user_id
  );

  // section visibility flags
  const hasCompany = !!(
    lead.company_name || lead.company_razao_social || lead.company_cnpj ||
    lead.company_email || lead.company_telefone || lead.company_site ||
    lead.company_cidade || lead.company_endereco
  );
  const hasAddress = !!(
    lead.endereco || lead.cidade || lead.estado || lead.cep
  );
  const hasPerfil = !!(
    lead.cargo || lead.poder_investimento || lead.data_nascimento ||
    lead.instagram || lead.linkedin || lead.tiktok
  );
  const hasMarketing = !!(lead.campanha || lead.conjunto_anuncio || lead.anuncio);
  const hasCustom = !!(lead.lead_custom_values?.length);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-4 px-6 pt-6 pb-4 border-b border-slate-200">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full shrink-0 bg-blue-100 overflow-hidden flex items-center justify-center">
            {photoUrl ? (
              <img src={photoUrl} alt={lead.name} className="w-16 h-16 object-cover" />
            ) : (
              <span className="text-2xl font-bold text-blue-600 select-none">
                {lead.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-slate-900 truncate">{lead.name}</h2>
            {lead.cargo && (
              <p className="text-sm text-slate-500 mt-0.5">{lead.cargo}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${status.cls}`}>
                {status.label}
              </span>
              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${origin.cls}`}>
                {origin.label}
              </span>
              {lead.record_type && lead.record_type !== 'lead' && (
                <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                  {lead.record_type}
                </span>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 shrink-0">
            {!lead.is_over_plan && phoneDigits && (
              <a
                href={`https://wa.me/55${phoneDigits}`}
                target="_blank"
                rel="noreferrer"
                title="WhatsApp"
                className="p-2 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
              </a>
            )}
            {!lead.is_over_plan && lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                title="Ligar"
                className="p-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
              >
                <Phone className="w-5 h-5" />
              </a>
            )}
            {!lead.is_over_plan && lead.email && (
              <a
                href={`mailto:${lead.email}`}
                title="Enviar e-mail"
                className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
              >
                <Mail className="w-5 h-5" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── BODY ───────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">

          {/* Banner plano excedido */}
          {lead.is_over_plan && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <span className="text-amber-500 text-lg leading-none">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">Lead fora do plano</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Este lead foi criado acima do limite contratado. Dados de contato estão ocultos.
                  Faça upgrade do plano ou exclua leads antigos para liberá-lo.
                </p>
              </div>
            </div>
          )}

          {/* ── Contato ─────────────────────────────────────────────────── */}
          <Section title="Contato" icon={<User className="w-4 h-4" />}>
            {lead.is_over_plan ? (
              <>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Email</p>
                  <p className="text-sm italic text-slate-400">Dado restrito</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Telefone</p>
                  <p className="text-sm italic text-slate-400">Dado restrito</p>
                </div>
              </>
            ) : (
              <>
                <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
                <InfoRow icon={<Phone className="w-4 h-4" />} label="Telefone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              </>
            )}
            <InfoRow icon={<FileText className="w-4 h-4" />} label="Interesse" value={lead.interest} />
            <InfoRow
              icon={<User className="w-4 h-4" />}
              label="Responsável"
              value={responsible ? (responsible.display_name || responsible.email) : undefined}
            />
            <InfoRow icon={<Calendar className="w-4 h-4" />} label="Último contato" value={formatDateTime(lead.last_contact_at)} />
          </Section>

          {/* ── Empresa ─────────────────────────────────────────────────── */}
          {hasCompany && (
            <Section title="Empresa" icon={<Building2 className="w-4 h-4" />}>
              <InfoRow icon={<Building2 className="w-4 h-4" />} label="Nome" value={lead.company_nome_fantasia || lead.company_name} />
              <InfoRow icon={<Building2 className="w-4 h-4" />} label="Razão Social" value={lead.company_razao_social} />
              <InfoRow icon={<Hash className="w-4 h-4" />} label="CNPJ" value={lead.company_cnpj} mono />
              <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={lead.company_email} href={lead.company_email ? `mailto:${lead.company_email}` : undefined} />
              <InfoRow icon={<Phone className="w-4 h-4" />} label="Telefone" value={lead.company_telefone} href={lead.company_telefone ? `tel:${lead.company_telefone}` : undefined} />
              <InfoRow icon={<Globe className="w-4 h-4" />} label="Site" value={lead.company_site} href={lead.company_site} />
              <InfoRow icon={<MapPin className="w-4 h-4" />} label="Endereço" value={buildCompanyAddress(lead)} />
            </Section>
          )}

          {/* ── Perfil ──────────────────────────────────────────────────── */}
          {hasPerfil && (
            <Section title="Perfil" icon={<Briefcase className="w-4 h-4" />}>
              <InfoRow icon={<Briefcase className="w-4 h-4" />} label="Cargo" value={lead.cargo} />
              <InfoRow icon={<FileText className="w-4 h-4" />} label="Poder de Investimento" value={lead.poder_investimento} />
              <InfoRow icon={<Calendar className="w-4 h-4" />} label="Data de Nascimento" value={formatDate(lead.data_nascimento)} />
              {lead.instagram && (
                <InfoRow icon={<Instagram className="w-4 h-4" />} label="Instagram" value={lead.instagram} href={lead.instagram.startsWith('http') ? lead.instagram : `https://instagram.com/${lead.instagram.replace('@', '')}`} />
              )}
              {lead.linkedin && (
                <InfoRow icon={<Linkedin className="w-4 h-4" />} label="LinkedIn" value={lead.linkedin} href={lead.linkedin.startsWith('http') ? lead.linkedin : `https://linkedin.com/in/${lead.linkedin}`} />
              )}
              {lead.tiktok && (
                <InfoRow icon={<ExternalLink className="w-4 h-4" />} label="TikTok" value={lead.tiktok} href={lead.tiktok.startsWith('http') ? lead.tiktok : `https://tiktok.com/@${lead.tiktok.replace('@', '')}`} />
              )}
            </Section>
          )}

          {/* ── Endereço pessoal ────────────────────────────────────────── */}
          {hasAddress && (
            <Section title="Endereço" icon={<MapPin className="w-4 h-4" />}>
              <div className="sm:col-span-2">
                <InfoRow icon={<MapPin className="w-4 h-4" />} label="Endereço completo" value={buildAddress(lead)} />
              </div>
              <InfoRow label="CEP" value={lead.cep} mono />
              <InfoRow label="Bairro" value={lead.bairro} />
            </Section>
          )}

          {/* ── Marketing ───────────────────────────────────────────────── */}
          {hasMarketing && (
            <Section title="Marketing" icon={<Megaphone className="w-4 h-4" />}>
              <InfoRow icon={<Megaphone className="w-4 h-4" />} label="Campanha" value={lead.campanha} />
              <InfoRow label="Conjunto de Anúncio" value={lead.conjunto_anuncio} />
              <InfoRow label="Anúncio" value={lead.anuncio} />
            </Section>
          )}

          {/* ── Campos Personalizados ───────────────────────────────────── */}
          {hasCustom && (
            <Section title="Campos Personalizados" icon={<FileText className="w-4 h-4" />}>
              {lead.lead_custom_values!.map((cv, i) => (
                <InfoRow
                  key={i}
                  label={cv.lead_custom_fields.field_label || cv.lead_custom_fields.field_name}
                  value={
                    cv.lead_custom_fields.field_type === 'boolean'
                      ? (cv.value === 'true' ? 'Sim' : 'Não')
                      : cv.value || undefined
                  }
                />
              ))}
            </Section>
          )}

          {/* ── Informações Técnicas (colapsável) ───────────────────────── */}
          <Section
            title="Informações Técnicas"
            icon={<ExternalLink className="w-4 h-4" />}
            collapsible
            defaultOpen={false}
          >
            <InfoRow label="ID" value={String(lead.id)} mono />
            <InfoRow label="Tipo de Registro" value={lead.record_type} />
            <InfoRow icon={<Calendar className="w-4 h-4" />} label="Criado em" value={formatDateTime(lead.created_at)} />
            <InfoRow icon={<Calendar className="w-4 h-4" />} label="Atualizado em" value={formatDateTime(lead.updated_at)} />
            {lead.visitor_id && (
              <div className="sm:col-span-2">
                <InfoRow icon={<ExternalLink className="w-4 h-4" />} label="Visitor ID" value={lead.visitor_id} mono />
              </div>
            )}
          </Section>
        </div>

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium"
          >
            Fechar
          </button>
          <button
            onClick={() => { onEdit(lead); onClose(); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <FileText className="w-4 h-4" />
            Editar Lead
          </button>
        </div>
      </div>
    </div>
  );
};
