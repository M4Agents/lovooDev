import {
  ASSIGNMENT_ID,
  COMPANY_ID,
  PARENT_ID,
  acceptedPut,
  makeChain,
  makeReq,
  makeSvc,
} from '../../catalogUpload/__tests__/fixtures.js'

export const FOLDER_ID = '99999999-9999-4999-8999-999999999999'

export function libraryEnv(secret = 'l'.repeat(32)) {
  return { MEDIA_LIBRARY_UPLOAD_TOKEN_SECRET: secret }
}

export function libraryBody(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    folderId: FOLDER_ID,
    fileName: 'foto.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    ...overrides,
  }
}

export function companyPlan(storageMb) {
  return makeChain({
    plan_id: 'abababab-abab-4bab-8bab-abababababab',
    plans: {
      id: 'abababab-abab-4bab-8bab-abababababab',
      name: 'Pro',
      slug: 'pro',
      storage_mb: storageMb,
      features: {},
    },
  })
}

export function directSvc(role, folder = { id: FOLDER_ID, is_system_folder: false }, extraTables = {}) {
  return makeSvc({
    tables: {
      company_users: makeChain({ role }),
      company_folders: makeChain(folder),
      companies: companyPlan(null),
      ...extraTables,
    },
  })
}

export function parentLibrarySvc(role, folder = { id: FOLDER_ID, is_system_folder: false }) {
  return makeSvc({
    tableSeq: {
      company_users: [
        makeChain(null),
        makeChain({
          role,
          company_id: PARENT_ID,
          companies: { company_type: 'parent' },
        }),
        makeChain({
          role,
          company_id: PARENT_ID,
          companies: { company_type: 'parent' },
        }),
      ],
      companies: [
        makeChain({ parent_company_id: PARENT_ID }),
        makeChain({ id: COMPANY_ID }),
        companyPlan(null),
      ],
    },
    tables: {
      company_folders: makeChain(folder),
    },
  })
}

export function inheritedPartnerSvc(assignment = { id: ASSIGNMENT_ID }) {
  return makeSvc({
    tableSeq: {
      company_users: [
        makeChain(null),
        makeChain({
          role: 'partner',
          company_id: PARENT_ID,
          companies: { company_type: 'parent' },
        }),
      ],
      companies: [
        makeChain({ parent_company_id: PARENT_ID }),
        companyPlan(null),
      ],
    },
    tables: {
      partner_company_assignments: makeChain(assignment),
      company_folders: makeChain({ id: FOLDER_ID, is_system_folder: true }),
    },
  })
}

export function libraryReq(body, authorization = 'Bearer valid-token') {
  return makeReq(body, authorization)
}

export { acceptedPut, makeChain, makeSvc }
