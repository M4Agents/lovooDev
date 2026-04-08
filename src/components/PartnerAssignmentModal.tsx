import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserPlus, Trash2, Loader2, Users } from 'lucide-react';
import { Company } from '../lib/supabase';
import {
  getCompanyPartnerAssignments,
  getParentPartnerUsers,
  assignCompanyToPartner,
  revokeCompanyFromPartner,
  PartnerAssignment,
  PartnerUser,
} from '../services/partnerApi';

interface Props {
  company: Company;
  parentCompanyId: string;
  onClose: () => void;
}

export const PartnerAssignmentModal: React.FC<Props> = ({ company, parentCompanyId, onClose }) => {
  const { t } = useTranslation('companies');

  const [assignments, setAssignments]     = useState<PartnerAssignment[]>([]);
  const [allPartners, setAllPartners]     = useState<PartnerUser[]>([]);
  const [selectedPartner, setSelectedPartner] = useState('');
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [assigned, partners] = await Promise.all([
        getCompanyPartnerAssignments(company.id),
        getParentPartnerUsers(parentCompanyId),
      ]);
      setAssignments(assigned);
      setAllPartners(partners);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [company.id]);

  const assignedIds = new Set(assignments.map(a => a.partner_user_id));
  const availablePartners = allPartners.filter(p => !assignedIds.has(p.user_id));

  const handleAssign = async () => {
    if (!selectedPartner) return;
    setSaving(true);
    setError(null);
    try {
      await assignCompanyToPartner(selectedPartner, company.id);
      setSelectedPartner('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (partnerUserId: string) => {
    if (!confirm(t('partnerModal.confirmRevoke'))) return;
    setSaving(true);
    setError(null);
    try {
      await revokeCompanyFromPartner(partnerUserId, company.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {t('partnerModal.title')}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">{company.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('actions.cancel')}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Atribuir novo partner */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('partnerModal.assignLabel')}
            </label>
            <div className="flex gap-2">
              <select
                value={selectedPartner}
                onChange={(e) => setSelectedPartner(e.target.value)}
                disabled={loading || saving || availablePartners.length === 0}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm disabled:opacity-50"
              >
                <option value="">
                  {availablePartners.length === 0
                    ? t('partnerModal.noPartnersAvailable')
                    : t('partnerModal.selectPartner')}
                </option>
                {availablePartners.map(p => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.display_name} ({p.email})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAssign}
                disabled={!selectedPartner || saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                {t('partnerModal.assignButton')}
              </button>
            </div>
          </div>

          {/* Lista de partners atribuídos */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              {t('partnerModal.currentAssignments')}
              {assignments.length > 0 && (
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                  {assignments.length}
                </span>
              )}
            </h3>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                {t('partnerModal.noAssignments')}
              </div>
            ) : (
              <ul className="space-y-2">
                {assignments.map(a => (
                  <li
                    key={a.partner_user_id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{a.display_name}</p>
                      <p className="text-xs text-slate-500">{a.email}</p>
                      <p className="text-xs text-slate-400">
                        {t('partnerModal.assignedAt', {
                          date: new Date(a.assigned_at).toLocaleDateString('pt-BR'),
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(a.partner_user_id)}
                      disabled={saving}
                      aria-label={t('partnerModal.revokeButton')}
                      className="p-2 hover:bg-red-50 text-red-500 hover:text-red-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm font-medium transition-colors"
          >
            {t('actions.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
