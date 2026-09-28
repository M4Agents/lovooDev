/**
 * POST /api/leads/check-duplicate
 *
 * Verifica se já existe um lead com o mesmo telefone ou e-mail na empresa.
 * Usa service_role para ignorar RLS — garante que usuários com
 * restrict_leads_to_owner não criem duplicatas de leads de outros vendedores.
 *
 * Body: { company_id, phone?, email? }
 * Response: { isDuplicate, existingLead?: { id, name, phone, email, responsibleName, matchedBy } }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'

/**
 * Constrói os valores de lookup para phone_normalized.
 * Replica a lógica de api.ts:createLead e checkDuplicateLead do frontend.
 */
function buildPhoneLookupValues(phone: string): string[] {
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 10) return []

  const right11 = digits.slice(-11)
  const withoutNinth =
    digits.length === 13 && digits.startsWith('55') && digits.charAt(4) === '9'
      ? digits.slice(0, 4) + digits.slice(5)
      : null

  return [...new Set([digits, right11, withoutNinth].filter(Boolean) as string[])]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST') return jsonError(res, 405, 'Método não permitido')

  try {
    const token = extractToken(req.headers['authorization'] as string | undefined)
    if (!token) return jsonError(res, 401, 'Token de autenticação obrigatório')

    const { user, error: authError } = await getUserFromToken(token)
    if (!user || authError) return jsonError(res, 401, 'Não autenticado')

    const { company_id, phone, email } = (req.body ?? {}) as {
      company_id?: string
      phone?: string
      email?: string
    }
    if (!company_id) return jsonError(res, 400, 'company_id é obrigatório')

    const svc = getSupabaseAdmin()

    const member = await assertMembership(svc, user.id, company_id)
    if (!member) return jsonError(res, 403, 'Acesso negado')

    // NÃO usar .or('col.in.(a,b,c)') — o PostgREST parte o filtro nas vírgulas
    // do in.() e a query quebra. Telefone e e-mail são consultas separadas.
    const leadSelect = 'id, name, phone, email, responsible_user_id'
    const emailNorm = (email ?? '').trim().toLowerCase()
    const lookupValues = phone ? buildPhoneLookupValues(String(phone)) : []

    if (lookupValues.length === 0 && !emailNorm.includes('@')) {
      return res.status(200).json({ isDuplicate: false })
    }

    let found: {
      id: number
      name: string
      phone: string | null
      email: string | null
      responsible_user_id: string | null
    } | null = null
    let matchedBy: 'phone' | 'email' = 'phone'

    if (lookupValues.length > 0) {
      const { data: byPhone, error: phoneError } = await svc
        .from('leads')
        .select(leadSelect)
        .eq('company_id', company_id)
        .is('deleted_at', null)
        .in('phone_normalized', lookupValues)
        .limit(1)
        .maybeSingle()

      if (phoneError) {
        console.error('[check-duplicate] phone query error:', phoneError.message)
        return jsonError(res, 500, 'Erro ao verificar duplicata')
      }

      if (byPhone) {
        found = byPhone
        matchedBy = 'phone'
      }
    }

    if (!found && emailNorm.includes('@')) {
      const { data: byEmail, error: emailError } = await svc
        .from('leads')
        .select(leadSelect)
        .eq('company_id', company_id)
        .is('deleted_at', null)
        .ilike('email', emailNorm)
        .limit(1)
        .maybeSingle()

      if (emailError) {
        console.error('[check-duplicate] email query error:', emailError.message)
        return jsonError(res, 500, 'Erro ao verificar duplicata')
      }

      if (byEmail) {
        found = byEmail
        matchedBy = 'email'
      }
    }

    if (!found) {
      return res.status(200).json({ isDuplicate: false })
    }

    let responsibleName: string | null = null
    if (found.responsible_user_id) {
      const { data: responsibleUser } = await svc
        .from('company_users')
        .select('display_name, email')
        .eq('user_id', found.responsible_user_id)
        .eq('company_id', company_id)
        .eq('is_active', true)
        .maybeSingle()

      responsibleName =
        responsibleUser?.display_name ||
        responsibleUser?.email ||
        'usuário não identificado'
    }

    return res.status(200).json({
      isDuplicate: true,
      existingLead: {
        id: found.id,
        name: found.name,
        phone: found.phone,
        email: found.email,
        responsible_user_id: found.responsible_user_id,
        responsibleName,
        matchedBy,
      },
    })
  } catch (err: any) {
    console.error('[check-duplicate] unhandled:', err?.message)
    return jsonError(res, 500, 'Erro ao verificar duplicata')
  }
}
