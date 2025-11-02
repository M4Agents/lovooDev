import React from 'react';
import {
  X,
  User,
  Mail,
  Phone,
  Building,
  FileText,
  Calendar,
  ExternalLink,
  Eye
} from 'lucide-react';

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
  created_at: string;
  updated_at: string;
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

interface LeadViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onEdit: (lead: Lead) => void;
}

export const LeadViewModal: React.FC<LeadViewModalProps> = ({
  isOpen,
  onClose,
  lead,
  onEdit
}) => {
  if (!isOpen || !lead) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'novo': return 'bg-blue-100 text-blue-800';
      case 'em_qualificacao': return 'bg-yellow-100 text-yellow-800';
      case 'convertido': return 'bg-green-100 text-green-800';
      case 'perdido': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getOriginColor = (origin: string) => {
    switch (origin) {
      case 'landing_page': return 'bg-purple-100 text-purple-800';
      case 'whatsapp': return 'bg-green-100 text-green-800';
      case 'manual': return 'bg-blue-100 text-blue-800';
      case 'import': return 'bg-orange-100 text-orange-800';
      case 'api': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getOriginLabel = (origin: string) => {
    switch (origin) {
      case 'landing_page': return 'Landing Page';
      case 'whatsapp': return 'WhatsApp';
      case 'manual': return 'Manual';
      case 'import': return 'Importação';
      case 'api': return 'API Externa';
      default: return origin;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'novo': return 'Novo';
      case 'em_qualificacao': return 'Em Qualificação';
      case 'convertido': return 'Convertido';
      case 'perdido': return 'Perdido';
      default: return status;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Eye className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Detalhes do Lead
              </h2>
              <p className="text-sm text-gray-500">
                ID: {lead.id} • Criado em {formatDate(lead.created_at)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Informações Principais */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Informações Principais
              </h3>
              <div className="flex gap-2">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(lead.status)}`}>
                  {getStatusLabel(lead.status)}
                </span>
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getOriginColor(lead.origin)}`}>
                  {getOriginLabel(lead.origin)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Nome</p>
                  <p className="font-medium text-gray-900">{lead.name}</p>
                </div>
              </div>

              {lead.email && (
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium text-gray-900">
                      <a 
                        href={`mailto:${lead.email}`}
                        className="text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        {lead.email}
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {lead.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Telefone</p>
                    <p className="font-medium text-gray-900">
                      <a 
                        href={`tel:${lead.phone}`}
                        className="text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        {lead.phone}
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {lead.interest && (
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Interesse</p>
                    <p className="font-medium text-gray-900">{lead.interest}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Campos Personalizados */}
          {lead.lead_custom_values && lead.lead_custom_values.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Campos Personalizados
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {lead.lead_custom_values.map((customValue, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-500 mb-1">
                      {customValue.lead_custom_fields.field_label}
                    </p>
                    <p className="font-medium text-gray-900">
                      {customValue.lead_custom_fields.field_type === 'boolean' 
                        ? (customValue.value === 'true' ? 'Sim' : 'Não')
                        : customValue.value || 'Não informado'
                      }
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Informações Técnicas */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
              Informações Técnicas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <p className="text-sm text-gray-500">Data de Criação</p>
                </div>
                <p className="font-medium text-gray-900">
                  {formatDate(lead.created_at)}
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <p className="text-sm text-gray-500">Última Atualização</p>
                </div>
                <p className="font-medium text-gray-900">
                  {formatDate(lead.updated_at)}
                </p>
              </div>

              {lead.visitor_id && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <ExternalLink className="w-4 h-4 text-gray-400" />
                    <p className="text-sm text-gray-500">Visitor ID</p>
                  </div>
                  <p className="font-medium text-gray-900 text-xs">
                    {lead.visitor_id}
                  </p>
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Building className="w-4 h-4 text-gray-400" />
                  <p className="text-sm text-gray-500">Origem</p>
                </div>
                <p className="font-medium text-gray-900">
                  {getOriginLabel(lead.origin)}
                </p>
              </div>
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center justify-end space-x-3 pt-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Fechar
            </button>
            <button
              onClick={() => {
                onEdit(lead);
                onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <FileText className="w-4 h-4" />
              Editar Lead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
