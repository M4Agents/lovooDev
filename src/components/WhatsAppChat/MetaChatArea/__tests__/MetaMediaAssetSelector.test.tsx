// @vitest-environment jsdom
// =============================================================================
// MetaMediaAssetSelector.test.tsx — MVP4B
//
// Testa o seletor de media assets em isolamento.
// NÃO acessa Supabase real, endpoint real ou storage real.
//
// MAS-01  IMAGE → getCompanyFiles fileType=image
// MAS-02  VIDEO → fileType=video
// MAS-03  DOCUMENT → fileType=document
//
// MAS-04  IMAGE mostra somente JPEG/PNG (filtra mime incompatível)
// MAS-05  VIDEO mostra somente MP4/3GPP
// MAS-06  DOCUMENT mostra somente PDF
//
// MAS-07  asset compatível selecionável → onSelect com id correto
// MAS-08  asset acima do limite → desabilitado; onSelect não chamado
// MAS-09  mostra filename e tamanho formatado
// MAS-10  DOCUMENT sem preview_url usa ícone fallback
// MAS-11  IMAGE com preview_url quebrada → img oculta (onError)
// MAS-12  VIDEO usa preload=metadata (sem autoplay)
//
// MAS-13  loading state exibido na carga inicial
// MAS-14  empty state quando lista vazia
// MAS-15  error state com mensagem
// MAS-16  retry reinicia carregamento
//
// MAS-17  paginação append — arquivos anteriores preservados
// MAS-18  "Carregar mais" solicita próxima página
//
// MAS-19  search debounce — não dispara antes do debounce
// MAS-20  search reseta page e items
//
// MAS-21  stale mediaFormat — resposta antiga descartada
// MAS-22  stale search — resposta antiga descartada
// MAS-23  unmount durante carregamento — nenhum setState tardio
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render, screen, fireEvent, cleanup, waitFor, act,
} from '@testing-library/react'
import { MetaMediaAssetSelector } from '../MetaMediaAssetSelector'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('../../../../services/mediaLibraryApi', () => ({
  mediaLibraryApi: {
    getCompanyFiles: vi.fn(),
  },
}))

import { supabase }        from '../../../../lib/supabase'
import { mediaLibraryApi } from '../../../../services/mediaLibraryApi'

const mockGetSession     = supabase.auth.getSession     as ReturnType<typeof vi.fn>
const mockGetCompanyFiles = mediaLibraryApi.getCompanyFiles as ReturnType<typeof vi.fn>

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY  = 'co-001'
const TOKEN    = 'fake-session-token'

function sessionOk() {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: TOKEN } } })
}

function makeFile(overrides: Partial<{
  id:                string
  original_filename: string
  file_type:         string
  mime_type:         string
  file_size:         number
  preview_url:       string | null
}> = {}) {
  return {
    id:                overrides.id                ?? 'file-001',
    original_filename: overrides.original_filename ?? 'foto.jpg',
    file_type:         overrides.file_type         ?? 'image',
    mime_type:         overrides.mime_type         ?? 'image/jpeg',
    file_size:         overrides.file_size         ?? 1_000_000,
    preview_url:       overrides.preview_url       ?? 'https://cdn.example.com/foto.jpg',
    s3_key:            'biblioteca/companies/co-001/foto.jpg',
    received_at:       '2026-09-01T10:00:00.000Z',
    created_at:        '2026-09-01T10:00:00.000Z',
  }
}

function makePaginatedResult(files: ReturnType<typeof makeFile>[], hasNextPage = false, totalCount?: number) {
  const tc = totalCount ?? files.length
  return {
    files,
    pagination: {
      page: 1, limit: 50, total: tc, totalCount: tc,
      totalPages: Math.ceil(tc / 50),
      hasNextPage,
      hasPrevPage: false,
    },
    filters: { leadId: '', file_type: 'all', search: '' },
    lastUpdated: new Date().toISOString(),
  }
}

const defaultOnSelect = vi.fn()

type PickerProps = Parameters<typeof MetaMediaAssetSelector>[0]

function renderSelector(props: Partial<PickerProps> = {}) {
  return render(
    <MetaMediaAssetSelector
      companyId={props.companyId ?? COMPANY}
      mediaFormat={props.mediaFormat ?? 'IMAGE'}
      selectedAssetId={props.selectedAssetId}
      onSelect={props.onSelect ?? defaultOnSelect}
      disabled={props.disabled}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionOk()
})

afterEach(() => {
  cleanup()
})

// =============================================================================
// MAS-01..03 — Mapeamento de mediaFormat → fileType
// =============================================================================

describe('MetaMediaAssetSelector — mapeamento fileType', () => {
  it('MAS-01: IMAGE → getCompanyFiles com fileType=image', async () => {
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([]))
    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalled())
    expect(mockGetCompanyFiles.mock.calls[0][2]).toMatchObject({ fileType: 'image' })
  })

  it('MAS-02: VIDEO → getCompanyFiles com fileType=video', async () => {
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([]))
    renderSelector({ mediaFormat: 'VIDEO' })
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalled())
    expect(mockGetCompanyFiles.mock.calls[0][2]).toMatchObject({ fileType: 'video' })
  })

  it('MAS-03: DOCUMENT → getCompanyFiles com fileType=document', async () => {
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([]))
    renderSelector({ mediaFormat: 'DOCUMENT' })
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalled())
    expect(mockGetCompanyFiles.mock.calls[0][2]).toMatchObject({ fileType: 'document' })
  })
})

// =============================================================================
// MAS-04..06 — Filtro MIME visual (UX)
// =============================================================================

describe('MetaMediaAssetSelector — filtro MIME visual', () => {
  it('MAS-04: IMAGE mostra JPEG/PNG selecionáveis; GIF desabilitado', async () => {
    const jpeg = makeFile({ id: 'f-jpeg', mime_type: 'image/jpeg', file_type: 'image' })
    const png  = makeFile({ id: 'f-png',  mime_type: 'image/png',  file_type: 'image', original_filename: 'img.png' })
    const gif  = makeFile({ id: 'f-gif',  mime_type: 'image/gif',  file_type: 'image', original_filename: 'img.gif' })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([jpeg, png, gif]))

    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => screen.getByTestId('mas-asset-f-jpeg'))

    const jpegBtn = screen.getByTestId('mas-asset-f-jpeg') as HTMLButtonElement
    const pngBtn  = screen.getByTestId('mas-asset-f-png')  as HTMLButtonElement
    const gifBtn  = screen.getByTestId('mas-asset-f-gif')  as HTMLButtonElement

    expect(jpegBtn.disabled).toBe(false)
    expect(pngBtn.disabled).toBe(false)
    expect(gifBtn.disabled).toBe(true)   // GIF não está na whitelist
  })

  it('MAS-05: VIDEO mostra MP4/3GPP selecionáveis; AVI desabilitado', async () => {
    const mp4  = makeFile({ id: 'v-mp4',  mime_type: 'video/mp4',  file_type: 'video', original_filename: 'vid.mp4' })
    const gpp  = makeFile({ id: 'v-3gpp', mime_type: 'video/3gpp', file_type: 'video', original_filename: 'vid.3gp' })
    const avi  = makeFile({ id: 'v-avi',  mime_type: 'video/avi',  file_type: 'video', original_filename: 'vid.avi' })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([mp4, gpp, avi]))

    renderSelector({ mediaFormat: 'VIDEO' })
    await waitFor(() => screen.getByTestId('mas-asset-v-mp4'))

    expect((screen.getByTestId('mas-asset-v-mp4')  as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('mas-asset-v-3gpp') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('mas-asset-v-avi')  as HTMLButtonElement).disabled).toBe(true)
  })

  it('MAS-06: DOCUMENT mostra PDF selecionável; DOCX desabilitado', async () => {
    const pdf  = makeFile({ id: 'd-pdf',  mime_type: 'application/pdf',   file_type: 'document', original_filename: 'doc.pdf' })
    const docx = makeFile({ id: 'd-docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_type: 'document', original_filename: 'doc.docx' })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([pdf, docx]))

    renderSelector({ mediaFormat: 'DOCUMENT' })
    await waitFor(() => screen.getByTestId('mas-asset-d-pdf'))

    expect((screen.getByTestId('mas-asset-d-pdf')  as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('mas-asset-d-docx') as HTMLButtonElement).disabled).toBe(true)
  })
})

// =============================================================================
// MAS-07..09 — Seleção e informações
// =============================================================================

describe('MetaMediaAssetSelector — seleção e display', () => {
  it('MAS-07: clicar asset compatível → onSelect com id correto', async () => {
    const file = makeFile({ id: 'f-sel-001', mime_type: 'image/jpeg' })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([file]))

    const onSelect = vi.fn()
    renderSelector({ mediaFormat: 'IMAGE', onSelect })
    await waitFor(() => screen.getByTestId('mas-asset-f-sel-001'))

    fireEvent.click(screen.getByTestId('mas-asset-f-sel-001'))
    expect(onSelect).toHaveBeenCalledWith({ id: 'f-sel-001' })
    // Somente id — nenhum campo proibido
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('s3_key')
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('mime_type')
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('preview_url')
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('file_size')
  })

  it('MAS-08: asset acima do limite → desabilitado; onSelect NÃO chamado', async () => {
    // IMAGE limite = 5 MB; arquivo = 6 MB
    const big = makeFile({ id: 'f-big-001', mime_type: 'image/jpeg', file_size: 6_000_000 })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([big]))

    const onSelect = vi.fn()
    renderSelector({ mediaFormat: 'IMAGE', onSelect })
    await waitFor(() => screen.getByTestId('mas-asset-f-big-001'))

    const btn = screen.getByTestId('mas-asset-f-big-001') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('MAS-09: filename e tamanho formatado visíveis', async () => {
    const file = makeFile({ id: 'f-info-001', original_filename: 'relatorio.jpg', file_size: 2_500_000 })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([file]))

    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => screen.getByText('relatorio.jpg'))
    // Tamanho: 2.5 MB (ou 2500000 / 1024 / 1024 ≈ 2.4 MB — aceitar qualquer número + MB)
    const sizeEl = screen.getByTestId('mas-asset-f-info-001')
    expect(sizeEl.textContent).toMatch(/MB/)
  })

  it('MAS-10: DOCUMENT sem preview_url usa ícone fallback (📄)', async () => {
    const doc = makeFile({
      id: 'd-icon-001', file_type: 'document', mime_type: 'application/pdf',
      original_filename: 'arquivo.pdf', preview_url: null,
    })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([doc]))

    renderSelector({ mediaFormat: 'DOCUMENT' })
    await waitFor(() => screen.getByTestId('mas-asset-d-icon-001'))
    expect(screen.getByTestId('mas-doc-icon')).toBeTruthy()
  })

  it('MAS-11: IMAGE com preview_url quebrada → img oculta via onError (sem crash)', async () => {
    const file = makeFile({ id: 'f-broken-001', preview_url: 'https://broken.example.com/404.jpg' })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([file]))

    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => screen.getByTestId('mas-asset-f-broken-001'))

    const img = screen.getByTestId('mas-image-preview') as HTMLImageElement
    expect(img).toBeTruthy()
    // Simular erro de carregamento da imagem
    fireEvent.error(img)
    expect(img.style.display).toBe('none')
  })

  it('MAS-12: VIDEO usa preload=metadata e NÃO tem autoplay', async () => {
    const vid = makeFile({
      id: 'v-noauto-001', file_type: 'video', mime_type: 'video/mp4',
      original_filename: 'video.mp4', preview_url: 'https://cdn.example.com/video.mp4',
    })
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([vid]))

    renderSelector({ mediaFormat: 'VIDEO' })
    await waitFor(() => screen.getByTestId('mas-asset-v-noauto-001'))

    const videoEl = screen.getByTestId('mas-video-preview') as HTMLVideoElement
    expect(videoEl.preload).toBe('metadata')
    expect(videoEl.hasAttribute('autoplay')).toBe(false)
    expect(videoEl.autoplay).toBe(false)
  })
})

// =============================================================================
// MAS-13..16 — Estados de carga
// =============================================================================

describe('MetaMediaAssetSelector — loading / empty / error / retry', () => {
  it('MAS-13: loading exibido durante carga inicial', async () => {
    // O componente chama getSession() antes de getCompanyFiles (async boundary).
    // Portanto, o loading já está visível assim que o componente monta.
    let resolve!: (v: unknown) => void
    mockGetCompanyFiles.mockImplementation(() => new Promise(r => { resolve = r }))

    renderSelector()
    // Spinner visível imediatamente após mount (antes mesmo de getCompanyFiles ser chamado)
    expect(screen.getByTestId('mas-loading')).toBeTruthy()

    // Aguardar getCompanyFiles ser chamado (após getSession resolver como microtask)
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalled())

    // Resolver para não deixar promise pendente e evitar warning de act()
    await act(async () => { resolve(makePaginatedResult([])) })
  })

  it('MAS-14: empty state quando lista retorna vazia', async () => {
    mockGetCompanyFiles.mockResolvedValueOnce(makePaginatedResult([]))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-empty'))
    expect(screen.getByTestId('mas-empty').textContent).toContain('Nenhuma')
  })

  it('MAS-15: error state com mensagem amigável', async () => {
    mockGetCompanyFiles.mockRejectedValueOnce(new Error('network_error'))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-error'))
    expect(screen.getByText(/Tentar novamente/i)).toBeTruthy()
  })

  it('MAS-16: clicar Tentar novamente reinicia carregamento', async () => {
    mockGetCompanyFiles
      .mockRejectedValueOnce(new Error('network_error'))
      .mockResolvedValueOnce(makePaginatedResult([makeFile({ id: 'f-retry-001' })]))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-error'))
    fireEvent.click(screen.getByText(/Tentar novamente/i))
    await waitFor(() => screen.getByTestId('mas-asset-f-retry-001'))
    expect(mockGetCompanyFiles).toHaveBeenCalledTimes(2)
  })
})

// =============================================================================
// MAS-17..18 — Paginação
// =============================================================================

describe('MetaMediaAssetSelector — paginação', () => {
  it('MAS-17: "Carregar mais" faz append dos novos itens preservando os anteriores', async () => {
    const page1 = [makeFile({ id: 'pg1-001', original_filename: 'pg1.jpg' })]
    const page2 = [makeFile({ id: 'pg2-001', original_filename: 'pg2.jpg', mime_type: 'image/jpeg' })]

    mockGetCompanyFiles
      .mockResolvedValueOnce(makePaginatedResult(page1, true, 2))
      .mockResolvedValueOnce(makePaginatedResult(page2, false, 2))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-asset-pg1-001'))

    // Botão "Carregar mais" visível
    const loadMoreBtn = screen.getByTestId('mas-load-more')
    expect(loadMoreBtn).toBeTruthy()

    await act(async () => { fireEvent.click(loadMoreBtn) })
    await waitFor(() => screen.getByTestId('mas-asset-pg2-001'))

    // Ambos os itens visíveis
    expect(screen.getByTestId('mas-asset-pg1-001')).toBeTruthy()
    expect(screen.getByTestId('mas-asset-pg2-001')).toBeTruthy()
  })

  it('MAS-18: "Carregar mais" solicita página seguinte com page correto', async () => {
    const page1 = [makeFile({ id: 'pg1-002', original_filename: 'pg1.jpg' })]

    mockGetCompanyFiles
      .mockResolvedValueOnce(makePaginatedResult(page1, true, 2))
      .mockResolvedValueOnce(makePaginatedResult([], false, 2))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-load-more'))

    await act(async () => { fireEvent.click(screen.getByTestId('mas-load-more')) })
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(2))

    // Segunda chamada deve usar page=2
    expect(mockGetCompanyFiles.mock.calls[1][2]).toMatchObject({ page: 2 })
  })
})

// =============================================================================
// MAS-19..20 — Search com debounce
// =============================================================================

describe('MetaMediaAssetSelector — search', () => {
  it('MAS-19: search não dispara request imediato antes do debounce', async () => {
    mockGetCompanyFiles.mockResolvedValue(makePaginatedResult([]))

    renderSelector()
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(1))

    // Digitar sem avançar o timer
    fireEvent.change(screen.getByLabelText('Buscar mídia'), { target: { value: 'abc' } })

    // Ainda apenas 1 chamada (a inicial)
    expect(mockGetCompanyFiles).toHaveBeenCalledTimes(1)
  })

  it('MAS-20: após debounce, search reseta page e items e carrega com query correta', async () => {
    // Usar timers reais para evitar interação problemática entre vi.useFakeTimers e waitFor/act.
    // O debounce é 350ms; aguardamos 500ms com timer real para garantir disparo.
    const searchFile = makeFile({ id: 'search-001', original_filename: 'resultado.jpg' })

    mockGetCompanyFiles
      .mockResolvedValueOnce(makePaginatedResult([]))            // carga inicial
      .mockResolvedValueOnce(makePaginatedResult([searchFile])) // após debounce

    renderSelector()
    // Aguardar carga inicial
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(1))

    // Digitar no input de busca
    fireEvent.change(screen.getByLabelText('Buscar mídia'), { target: { value: 'resultado' } })

    // Aguardar disparo do debounce (> 350ms) e segunda chamada
    await waitFor(
      () => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(2),
      { timeout: 2000 },
    )

    // Chamada com search correto e page=1
    expect(mockGetCompanyFiles.mock.calls[1][2]).toMatchObject({ search: 'resultado', page: 1 })
  }, 8000)
})

// =============================================================================
// MAS-21..23 — Proteção stale
// =============================================================================

describe('MetaMediaAssetSelector — stale guards', () => {
  it('MAS-21: stale response de mediaFormat anterior descartada ao trocar formato', async () => {
    let resolveImage!: (v: unknown) => void
    const imageResult = makePaginatedResult([makeFile({ id: 'img-stale-001', original_filename: 'foto.jpg' })])
    const docResult   = makePaginatedResult([makeFile({ id: 'doc-001', mime_type: 'application/pdf', file_type: 'document', original_filename: 'doc.pdf' })])

    mockGetCompanyFiles
      .mockImplementationOnce(() => new Promise(r => { resolveImage = r })) // IMAGE — pendente
      .mockResolvedValueOnce(docResult)                                       // DOCUMENT — resolve imediato

    const { rerender } = renderSelector({ mediaFormat: 'IMAGE' })

    // Aguardar IMAGE iniciar carregamento (getSession → getCompanyFiles)
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(1))

    // Trocar para DOCUMENT antes de IMAGE resolver
    await act(async () => {
      rerender(
        <MetaMediaAssetSelector
          companyId={COMPANY}
          mediaFormat="DOCUMENT"
          onSelect={defaultOnSelect}
        />
      )
    })

    await waitFor(() => screen.getByTestId('mas-asset-doc-001'))

    // Resolver IMAGE com resultado stale (após DOCUMENT já estar renderizado)
    await act(async () => { resolveImage(imageResult) })

    // img-stale-001 NÃO deve aparecer (resposta IMAGE descartada pelo stale guard)
    expect(screen.queryByTestId('mas-asset-img-stale-001')).toBeNull()
    // doc-001 continua visível
    expect(screen.getByTestId('mas-asset-doc-001')).toBeTruthy()
  })

  it('MAS-22: stale search response descartada quando nova busca inicia antes de resolver', async () => {
    // Usa timers reais para evitar conflito com waitFor.
    let resolveAbc!: (v: unknown) => void
    const abcResult = makePaginatedResult([makeFile({ id: 'abc-001', original_filename: 'abc.jpg' })])
    const xyzResult = makePaginatedResult([makeFile({ id: 'xyz-001', original_filename: 'xyz.jpg', mime_type: 'image/jpeg' })])

    mockGetCompanyFiles
      .mockResolvedValueOnce(makePaginatedResult([]))              // carga inicial
      .mockImplementationOnce(() => new Promise(r => { resolveAbc = r })) // "abc" — pendente
      .mockResolvedValueOnce(xyzResult)                            // "xyz" — resolve imediato

    renderSelector()
    // Aguardar carga inicial
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(1))

    // Digitar "abc" — dispara após debounce (≥350ms)
    fireEvent.change(screen.getByLabelText('Buscar mídia'), { target: { value: 'abc' } })
    // Aguardar chamada de "abc"
    await waitFor(
      () => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(2),
      { timeout: 2000 },
    )

    // Digitar "xyz" antes de "abc" resolver
    fireEvent.change(screen.getByLabelText('Buscar mídia'), { target: { value: 'xyz' } })
    // Aguardar chamada de "xyz"
    await waitFor(
      () => expect(mockGetCompanyFiles).toHaveBeenCalledTimes(3),
      { timeout: 2000 },
    )

    await waitFor(() => screen.getByTestId('mas-asset-xyz-001'))

    // Resolver "abc" (stale) — resultado deve ser descartado
    await act(async () => { resolveAbc(abcResult) })

    // abc-001 NÃO deve aparecer (stale guard descartou)
    expect(screen.queryByTestId('mas-asset-abc-001')).toBeNull()
    // xyz-001 continua visível
    expect(screen.getByTestId('mas-asset-xyz-001')).toBeTruthy()
  }, 15000)

  it('MAS-23: unmount durante carregamento → nenhum setState tardio / sem warning', async () => {
    let resolve!: (v: unknown) => void
    mockGetCompanyFiles.mockImplementation(() => new Promise(r => { resolve = r }))

    const { unmount } = renderSelector()

    // Aguardar getCompanyFiles ser chamado (após getSession como microtask)
    await waitFor(() => expect(mockGetCompanyFiles).toHaveBeenCalled())

    // Desmontar enquanto promise ainda pendente
    unmount()

    // Resolver após unmount — stale guard (mountedRef / cancelled) deve impedir setState
    await expect(act(async () => {
      resolve(makePaginatedResult([makeFile()]))
    })).resolves.toBeUndefined()
  })
})
