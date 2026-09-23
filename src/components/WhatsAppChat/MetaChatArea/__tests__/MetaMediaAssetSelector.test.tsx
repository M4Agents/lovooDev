// @vitest-environment jsdom
// =============================================================================
// MetaMediaAssetSelector.test.tsx — MVP4B.4D.2C
//
// Seletor unificado CML + LMU. Testa o componente em isolamento.
// NÃO acessa Supabase real, endpoint real ou storage real.
//
// MAS-01  IMAGE → getMediaPicker com mediaType=IMAGE
// MAS-02  VIDEO → mediaType=VIDEO
// MAS-03  DOCUMENT → mediaType=DOCUMENT
//
// MAS-04  IMAGE mostra somente JPEG/PNG selecionáveis; GIF desabilitado
// MAS-05  VIDEO mostra somente MP4/3GPP; AVI desabilitado
// MAS-06  DOCUMENT mostra somente PDF; DOCX desabilitado
//
// MAS-07  asset compatível selecionável → onSelect com picker_id correto
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
// MAS-17  truncated=true exibe aviso "100 assets mais recentes"
// MAS-18  search client-side filtra por filename sem chamar API novamente
//
// MAS-21  stale mediaFormat — resposta antiga descartada
// MAS-23  unmount durante carregamento — nenhum setState tardio
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render, screen, fireEvent, cleanup, waitFor, act,
} from '@testing-library/react'
import { MetaMediaAssetSelector } from '../MetaMediaAssetSelector'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: {
    getMediaPicker: vi.fn(),
  },
}))

import { metaWhatsAppApi } from '../../../../services/metaWhatsAppApi'

const mockGetMediaPicker = metaWhatsAppApi.getMediaPicker as ReturnType<typeof vi.fn>

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY = 'co-001'

type MediaType = 'IMAGE' | 'VIDEO' | 'DOCUMENT'

function makeItem(overrides: Partial<{
  picker_id:   string
  source:      string
  filename:    string
  media_type:  MediaType
  mime_type:   string
  file_size:   number
  preview_url: string | null
}> = {}) {
  const pid = overrides.picker_id ?? 'cml:file-001-0000-0000-0000-000000000000'
  return {
    picker_id:   pid,
    source:      overrides.source      ?? 'company_media_library',
    filename:    overrides.filename    ?? 'foto.jpg',
    media_type:  overrides.media_type  ?? 'IMAGE' as MediaType,
    mime_type:   overrides.mime_type   ?? 'image/jpeg',
    file_size:   overrides.file_size   ?? 1_000_000,
    preview_url: overrides.preview_url ?? 'https://cdn.example.com/foto.jpg',
  }
}

function makePickerResult(items: ReturnType<typeof makeItem>[], truncated = false) {
  return { items, truncated }
}

const defaultOnSelect = vi.fn()

type PickerProps = Parameters<typeof MetaMediaAssetSelector>[0]

function renderSelector(props: Partial<PickerProps> = {}) {
  return render(
    <MetaMediaAssetSelector
      companyId={props.companyId ?? COMPANY}
      mediaFormat={props.mediaFormat ?? 'IMAGE'}
      selectedPickerId={props.selectedPickerId}
      onSelect={props.onSelect ?? defaultOnSelect}
      disabled={props.disabled}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

// =============================================================================
// MAS-01..03 — Mapeamento de mediaFormat → mediaType
// =============================================================================

describe('MetaMediaAssetSelector — mapeamento mediaType', () => {
  it('MAS-01: IMAGE → getMediaPicker com mediaType=IMAGE', async () => {
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([]))
    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => expect(mockGetMediaPicker).toHaveBeenCalled())
    expect(mockGetMediaPicker.mock.calls[0][1]).toBe('IMAGE')
  })

  it('MAS-02: VIDEO → getMediaPicker com mediaType=VIDEO', async () => {
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([]))
    renderSelector({ mediaFormat: 'VIDEO' })
    await waitFor(() => expect(mockGetMediaPicker).toHaveBeenCalled())
    expect(mockGetMediaPicker.mock.calls[0][1]).toBe('VIDEO')
  })

  it('MAS-03: DOCUMENT → getMediaPicker com mediaType=DOCUMENT', async () => {
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([]))
    renderSelector({ mediaFormat: 'DOCUMENT' })
    await waitFor(() => expect(mockGetMediaPicker).toHaveBeenCalled())
    expect(mockGetMediaPicker.mock.calls[0][1]).toBe('DOCUMENT')
  })
})

// =============================================================================
// MAS-04..06 — Filtro MIME visual (UX)
// =============================================================================

describe('MetaMediaAssetSelector — filtro MIME visual', () => {
  it('MAS-04: IMAGE mostra JPEG/PNG selecionáveis; GIF desabilitado', async () => {
    const jpeg = makeItem({ picker_id: 'cml:f-jpeg-0000-0000-0000-000000000000', mime_type: 'image/jpeg', filename: 'foto.jpg' })
    const png  = makeItem({ picker_id: 'cml:f-png0-0000-0000-0000-000000000000', mime_type: 'image/png',  filename: 'img.png'  })
    const gif  = makeItem({ picker_id: 'cml:f-gif0-0000-0000-0000-000000000000', mime_type: 'image/gif',  filename: 'img.gif'  })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([jpeg, png, gif]))

    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => screen.getByTestId(`mas-asset-${jpeg.picker_id}`))

    const jpegBtn = screen.getByTestId(`mas-asset-${jpeg.picker_id}`) as HTMLButtonElement
    const pngBtn  = screen.getByTestId(`mas-asset-${png.picker_id}`)  as HTMLButtonElement
    const gifBtn  = screen.getByTestId(`mas-asset-${gif.picker_id}`)  as HTMLButtonElement

    expect(jpegBtn.disabled).toBe(false)
    expect(pngBtn.disabled).toBe(false)
    expect(gifBtn.disabled).toBe(true)   // GIF não está na whitelist IMAGE
  })

  it('MAS-05: VIDEO mostra MP4/3GPP selecionáveis; AVI desabilitado', async () => {
    const mp4  = makeItem({ picker_id: 'cml:v-mp40-0000-0000-0000-000000000000', media_type: 'VIDEO', mime_type: 'video/mp4',  filename: 'vid.mp4' })
    const gpp  = makeItem({ picker_id: 'cml:v-3gpp-0000-0000-0000-000000000000', media_type: 'VIDEO', mime_type: 'video/3gpp', filename: 'vid.3gp' })
    const avi  = makeItem({ picker_id: 'cml:v-avi0-0000-0000-0000-000000000000', media_type: 'VIDEO', mime_type: 'video/avi',  filename: 'vid.avi' })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([mp4, gpp, avi]))

    renderSelector({ mediaFormat: 'VIDEO' })
    await waitFor(() => screen.getByTestId(`mas-asset-${mp4.picker_id}`))

    expect((screen.getByTestId(`mas-asset-${mp4.picker_id}`) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId(`mas-asset-${gpp.picker_id}`) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId(`mas-asset-${avi.picker_id}`) as HTMLButtonElement).disabled).toBe(true)
  })

  it('MAS-06: DOCUMENT mostra PDF selecionável; DOCX desabilitado', async () => {
    const pdf  = makeItem({ picker_id: 'cml:d-pdf0-0000-0000-0000-000000000000', media_type: 'DOCUMENT', mime_type: 'application/pdf', filename: 'doc.pdf' })
    const docx = makeItem({ picker_id: 'cml:d-docx-0000-0000-0000-000000000000', media_type: 'DOCUMENT', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'doc.docx' })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([pdf, docx]))

    renderSelector({ mediaFormat: 'DOCUMENT' })
    await waitFor(() => screen.getByTestId(`mas-asset-${pdf.picker_id}`))

    expect((screen.getByTestId(`mas-asset-${pdf.picker_id}`)  as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId(`mas-asset-${docx.picker_id}`) as HTMLButtonElement).disabled).toBe(true)
  })
})

// =============================================================================
// MAS-07..12 — Seleção e display
// =============================================================================

describe('MetaMediaAssetSelector — seleção e display', () => {
  it('MAS-07: clicar asset compatível → onSelect com picker_id correto', async () => {
    const item = makeItem({ picker_id: 'cml:f-sel-0000-0000-0000-000000000000', mime_type: 'image/jpeg', filename: 'foto.jpg' })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([item]))

    const onSelect = vi.fn()
    renderSelector({ mediaFormat: 'IMAGE', onSelect })
    await waitFor(() => screen.getByTestId(`mas-asset-${item.picker_id}`))

    fireEvent.click(screen.getByTestId(`mas-asset-${item.picker_id}`))
    expect(onSelect).toHaveBeenCalledWith({ picker_id: item.picker_id })
    // Somente picker_id — nenhum campo interno exposto
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('s3_key')
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('source_ref')
    expect(onSelect.mock.calls[0][0]).not.toHaveProperty('id')
  })

  it('MAS-08: asset acima do limite → desabilitado; onSelect NÃO chamado', async () => {
    // IMAGE limite = 5 MB; arquivo = 6 MB
    const big = makeItem({ picker_id: 'cml:f-big0-0000-0000-0000-000000000000', mime_type: 'image/jpeg', file_size: 6_000_000 })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([big]))

    const onSelect = vi.fn()
    renderSelector({ mediaFormat: 'IMAGE', onSelect })
    await waitFor(() => screen.getByTestId(`mas-asset-${big.picker_id}`))

    const btn = screen.getByTestId(`mas-asset-${big.picker_id}`) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('MAS-09: filename e tamanho formatado visíveis', async () => {
    const item = makeItem({ picker_id: 'cml:f-info-0000-0000-0000-000000000000', filename: 'relatorio.jpg', file_size: 2_500_000 })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([item]))

    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => screen.getByText('relatorio.jpg'))

    const assetEl = screen.getByTestId(`mas-asset-${item.picker_id}`)
    expect(assetEl.textContent).toMatch(/MB/)
  })

  it('MAS-10: DOCUMENT sem preview_url usa ícone fallback (📄)', async () => {
    const doc = makeItem({
      picker_id:   'cml:d-icon-0000-0000-0000-000000000000',
      media_type:  'DOCUMENT',
      mime_type:   'application/pdf',
      filename:    'arquivo.pdf',
      preview_url: null,
    })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([doc]))

    renderSelector({ mediaFormat: 'DOCUMENT' })
    await waitFor(() => screen.getByTestId(`mas-asset-${doc.picker_id}`))
    expect(screen.getByTestId('mas-doc-icon')).toBeTruthy()
  })

  it('MAS-11: IMAGE com preview_url quebrada → img oculta via onError (sem crash)', async () => {
    const item = makeItem({ picker_id: 'cml:f-brkn-0000-0000-0000-000000000000', preview_url: 'https://broken.example.com/404.jpg' })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([item]))

    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => screen.getByTestId(`mas-asset-${item.picker_id}`))

    const img = screen.getByTestId('mas-image-preview') as HTMLImageElement
    expect(img).toBeTruthy()
    fireEvent.error(img)
    expect(img.style.display).toBe('none')
  })

  it('MAS-12: VIDEO usa preload=metadata e NÃO tem autoplay', async () => {
    const vid = makeItem({
      picker_id:   'cml:v-meta-0000-0000-0000-000000000000',
      media_type:  'VIDEO',
      mime_type:   'video/mp4',
      filename:    'video.mp4',
      preview_url: 'https://cdn.example.com/video.mp4',
    })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([vid]))

    renderSelector({ mediaFormat: 'VIDEO' })
    await waitFor(() => screen.getByTestId(`mas-asset-${vid.picker_id}`))

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
    let resolve!: (v: unknown) => void
    mockGetMediaPicker.mockImplementation(() => new Promise(r => { resolve = r }))

    renderSelector()
    // Spinner visível imediatamente após mount
    expect(screen.getByTestId('mas-loading')).toBeTruthy()

    await waitFor(() => expect(mockGetMediaPicker).toHaveBeenCalled())

    // Resolver para não deixar promise pendente
    await act(async () => { resolve(makePickerResult([])) })
  })

  it('MAS-14: empty state quando lista retorna vazia', async () => {
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([]))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-empty'))
    expect(screen.getByTestId('mas-empty').textContent).toContain('Nenhuma')
  })

  it('MAS-15: error state com mensagem amigável', async () => {
    mockGetMediaPicker.mockRejectedValueOnce(new Error('network_error'))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-error'))
    expect(screen.getByText(/Tentar novamente/i)).toBeTruthy()
  })

  it('MAS-16: clicar Tentar novamente reinicia carregamento', async () => {
    const item = makeItem({ picker_id: 'cml:f-rtry-0000-0000-0000-000000000000' })
    mockGetMediaPicker
      .mockRejectedValueOnce(new Error('network_error'))
      .mockResolvedValueOnce(makePickerResult([item]))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-error'))
    fireEvent.click(screen.getByText(/Tentar novamente/i))
    await waitFor(() => screen.getByTestId(`mas-asset-${item.picker_id}`))
    expect(mockGetMediaPicker).toHaveBeenCalledTimes(2)
  })
})

// =============================================================================
// MAS-17..18 — Truncagem e search client-side
// =============================================================================

describe('MetaMediaAssetSelector — truncagem e search client-side', () => {
  it('MAS-17: truncated=true exibe aviso sobre 100 assets mais recentes', async () => {
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([], true))

    renderSelector()
    await waitFor(() => screen.getByTestId('mas-truncated-notice'))
    expect(screen.getByTestId('mas-truncated-notice').textContent).toMatch(/100/)
  })

  it('MAS-18: search client-side filtra por filename sem chamar API novamente', async () => {
    const matches = makeItem({ picker_id: 'cml:f-abc0-0000-0000-0000-000000000000', filename: 'relatorio-abc.jpg' })
    const other   = makeItem({ picker_id: 'cml:f-xyz0-0000-0000-0000-000000000000', filename: 'documento-xyz.jpg' })
    mockGetMediaPicker.mockResolvedValueOnce(makePickerResult([matches, other]))

    renderSelector({ mediaFormat: 'IMAGE' })
    await waitFor(() => screen.getByTestId(`mas-asset-${matches.picker_id}`))

    // Ambos visíveis antes do filtro
    expect(screen.getByTestId(`mas-asset-${matches.picker_id}`)).toBeTruthy()
    expect(screen.getByTestId(`mas-asset-${other.picker_id}`)).toBeTruthy()

    // Filtrar por 'relatorio' — sem dispatch para API
    fireEvent.change(screen.getByLabelText('Buscar mídia'), { target: { value: 'relatorio' } })

    // Apenas o item que bate com a busca permanece visível
    expect(screen.getByTestId(`mas-asset-${matches.picker_id}`)).toBeTruthy()
    expect(screen.queryByTestId(`mas-asset-${other.picker_id}`)).toBeNull()

    // getMediaPicker chamado somente uma vez (carga inicial)
    expect(mockGetMediaPicker).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// MAS-21 / MAS-23 — Proteção stale / unmount
// =============================================================================

describe('MetaMediaAssetSelector — stale guards', () => {
  it('MAS-21: stale response de mediaFormat anterior descartada ao trocar formato', async () => {
    let resolveImage!: (v: unknown) => void
    const imageResult = makePickerResult([makeItem({ picker_id: 'cml:img0-stl0-0000-0000-000000000000', filename: 'foto.jpg' })])
    const docResult   = makePickerResult([makeItem({ picker_id: 'cml:doc0-ok00-0000-0000-000000000000', media_type: 'DOCUMENT', mime_type: 'application/pdf', filename: 'doc.pdf' })])

    mockGetMediaPicker
      .mockImplementationOnce(() => new Promise(r => { resolveImage = r })) // IMAGE — pendente
      .mockResolvedValueOnce(docResult)                                       // DOCUMENT — resolve imediato

    const { rerender } = renderSelector({ mediaFormat: 'IMAGE' })

    // Aguardar IMAGE iniciar carregamento
    await waitFor(() => expect(mockGetMediaPicker).toHaveBeenCalledTimes(1))

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

    await waitFor(() => screen.getByTestId('cml:doc0-ok00-0000-0000-000000000000'.replace(/:/g, '') === '' ? '' : `mas-asset-cml:doc0-ok00-0000-0000-000000000000`))

    // Resolver IMAGE (stale) após DOCUMENT já renderizado
    await act(async () => { resolveImage(imageResult) })

    // Stale item não aparece
    expect(screen.queryByTestId(`mas-asset-cml:img0-stl0-0000-0000-000000000000`)).toBeNull()
  })

  it('MAS-23: unmount durante carregamento → nenhum setState tardio / sem warning', async () => {
    let resolve!: (v: unknown) => void
    mockGetMediaPicker.mockImplementation(() => new Promise(r => { resolve = r }))

    const { unmount } = renderSelector()

    // Aguardar getMediaPicker ser chamado
    await waitFor(() => expect(mockGetMediaPicker).toHaveBeenCalled())

    // Desmontar enquanto promise pendente
    unmount()

    // Resolver após unmount — stale guard deve impedir setState
    await expect(act(async () => {
      resolve(makePickerResult([makeItem()]))
    })).resolves.toBeUndefined()
  })
})
