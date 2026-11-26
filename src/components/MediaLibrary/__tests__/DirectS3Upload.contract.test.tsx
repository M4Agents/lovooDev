/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectS3Upload } from '../DirectS3Upload'
import { LIBRARY_IMAGE_MAX_BYTES, LIBRARY_MEDIA_ACCEPT } from '../../../services/libraryMediaUpload'

const { getSession, onAuthStateChange, upload } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}))

vi.mock('../../../services/libraryMediaUpload', async () => {
  const actual = await vi.importActual<typeof import('../../../services/libraryMediaUpload')>('../../../services/libraryMediaUpload')
  return { ...actual, uploadLibraryMedia: (...args: unknown[]) => upload(...args) }
})

const COMPANY = 'bbbb0000-0000-4000-8000-000000000002'
const FOLDER = 'cccc0000-0000-4000-8000-000000000003'
const OTHER_FOLDER = 'dddd0000-0000-4000-8000-000000000004'
const USER = 'aaaa0000-0000-4000-8000-000000000001'
const OTHER = 'eeee0000-0000-4000-8000-000000000005'

const asset = {
  id: 'ffff0000-0000-4000-8000-000000000009',
  company_id: COMPANY,
  folder_id: FOLDER,
  operation_id: '11111111-1111-4111-8111-111111111111',
  s3_key: `clientes/${COMPANY}/library/2026/11/25/11111111-1111-4111-8111-111111111111/foto.png`,
  file_type: 'image' as const,
  mime_type: 'image/png',
  file_size: 32,
  original_filename: 'foto.png',
  preview_url: 'https://example-bucket.s3.us-east-1.amazonaws.com/clientes/foto.png',
}

function fileOf(type = 'image/png') {
  return new File([new Uint8Array(32)], 'foto.png', { type })
}

function renderUpload(folderId: string | undefined = FOLDER) {
  const onUploadComplete = vi.fn()
  const view = render(
    <DirectS3Upload
      companyId={COMPANY}
      folderId={folderId}
      showDragDrop
      onUploadComplete={onUploadComplete}
    />
  )
  return { ...view, onUploadComplete }
}

describe('DirectS3Upload', () => {
  beforeEach(() => {
    upload.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: USER } } }, error: null })
    onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    upload.mockResolvedValue({ ok: true, data: asset })
  })

  afterEach(() => {
    cleanup()
  })

  it('só publica o arquivo depois da confirmação', async () => {
    let resolveUpload: (value: unknown) => void = () => undefined
    upload.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve
    }))
    const { onUploadComplete } = renderUpload()
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [fileOf()] } })
    expect(await screen.findByText('Enviando... 30%')).toBeTruthy()
    expect(screen.queryByText(/100%/)).toBeNull()
    expect(onUploadComplete).not.toHaveBeenCalled()
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    resolveUpload({ ok: true, data: asset })
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith(asset))
    expect(onUploadComplete.mock.calls[0][0]).toMatchObject({
      id: asset.id,
      preview_url: asset.preview_url,
      file_type: 'image',
    })
  })

  it('ignora o segundo clique enquanto o envio está em andamento', async () => {
    upload.mockImplementation(() => new Promise(() => undefined))
    renderUpload()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [fileOf()] } })
    fireEvent.change(input, { target: { files: [fileOf()] } })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
  })

  it('cancela ao trocar a pasta, o usuário ou desmontar', async () => {
    const signals: AbortSignal[] = []
    upload.mockImplementation((_file: File, _company: string, _folder: string, signal: AbortSignal) => new Promise((resolve) => {
      signals.push(signal)
      signal.addEventListener('abort', () => resolve({ ok: false, error: 'Upload cancelado.', cancelled: true }))
    }))
    const first = renderUpload()
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [fileOf()] } })
    await waitFor(() => expect(signals).toHaveLength(1))
    first.rerender(
      <DirectS3Upload companyId={COMPANY} folderId={OTHER_FOLDER} showDragDrop onUploadComplete={first.onUploadComplete} />
    )
    await waitFor(() => expect(signals[0].aborted).toBe(true))
    expect(first.onUploadComplete).not.toHaveBeenCalled()

    cleanup()
    const second = renderUpload()
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [fileOf()] } })
    await waitFor(() => expect(signals).toHaveLength(2))
    const calls = onAuthStateChange.mock.calls
    const listener = calls[calls.length - 1]?.[0] as (event: string, session: { user?: { id?: string } } | null) => void
    listener('SIGNED_IN', { user: { id: OTHER } })
    await waitFor(() => expect(signals[1].aborted).toBe(true))
    expect(second.onUploadComplete).not.toHaveBeenCalled()

    cleanup()
    const third = renderUpload()
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [fileOf()] } })
    await waitFor(() => expect(signals).toHaveLength(3))
    third.unmount()
    await waitFor(() => expect(signals[2].aborted).toBe(true))
    expect(third.onUploadComplete).not.toHaveBeenCalled()
  })

  it('mostra erro local para MIME fora da allowlist e pasta ausente', async () => {
    const view = renderUpload()
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [fileOf('image/svg+xml')] },
    })
    expect(await screen.findByText('Tipo de arquivo não permitido.')).toBeTruthy()
    expect(upload).not.toHaveBeenCalled()

    view.rerender(
      <DirectS3Upload companyId={COMPANY} showDragDrop onUploadComplete={view.onUploadComplete} />
    )
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [fileOf()] } })
    expect(await screen.findByText('Selecione uma pasta.')).toBeTruthy()
    expect(upload).not.toHaveBeenCalled()
  })

  it('informa MIME vazio, incompatível e tamanho no arraste, sem aceitar só a extensão', async () => {
    renderUpload()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe(LIBRARY_MEDIA_ACCEPT)
    expect(input.accept).not.toContain('image/*')
    const zone = screen.getByText('Clique ou arraste arquivos aqui').parentElement?.parentElement as HTMLElement
    const drop = (file: File) => fireEvent.drop(zone, { dataTransfer: { files: [file] } })

    drop(new File([new Uint8Array(8)], 'foto.jpg', { type: '' }))
    expect(await screen.findByText('O tipo do arquivo não foi informado.')).toBeTruthy()

    drop(fileOf('image/svg+xml'))
    expect(await screen.findByText('Tipo de arquivo não permitido.')).toBeTruthy()

    const huge = fileOf('image/png')
    Object.defineProperty(huge, 'size', { value: LIBRARY_IMAGE_MAX_BYTES + 1 })
    drop(huge)
    expect(await screen.findByText('Arquivo acima de 10 MB.')).toBeTruthy()
    expect(upload).not.toHaveBeenCalled()
  })

  it('descarta a confirmação quando a pasta muda durante a leitura da resposta', async () => {
    let resolveUpload: (value: unknown) => void = () => undefined
    upload.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve
    }))
    const view = renderUpload()
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [fileOf()] } })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    view.rerender(
      <DirectS3Upload companyId={COMPANY} folderId={OTHER_FOLDER} showDragDrop onUploadComplete={view.onUploadComplete} />
    )
    resolveUpload({ ok: true, data: asset })
    await waitFor(() => expect(upload.mock.calls[0][3]).toMatchObject({ aborted: true }))
    expect(view.onUploadComplete).not.toHaveBeenCalled()
  })
})
