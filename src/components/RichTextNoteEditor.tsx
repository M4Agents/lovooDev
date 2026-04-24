import { useCallback } from 'react'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link as LinkIcon } from 'lucide-react'

// =====================================================
// TIPOS
// =====================================================

export interface RichTextNoteEditorProps {
  value: string
  onChange: (html: string) => void
  onSubmit?: () => void
  placeholder?: string
  disabled?: boolean
}

// =====================================================
// HELPERS
// =====================================================

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => {
        e.preventDefault()
        onClick()
      }}
      disabled={disabled}
      title={title}
      className={[
        'p-1.5 rounded transition-colors',
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// =====================================================
// COMPONENTE
// =====================================================

export function RichTextNoteEditor({
  value,
  onChange,
  onSubmit,
  placeholder = 'Escreva uma nota...',
  disabled = false,
}: RichTextNoteEditorProps) {
  // Extensão de atalho de teclado para Ctrl+Enter
  const SubmitOnCtrlEnter = Extension.create({
    name: 'submitOnCtrlEnter',
    addKeyboardShortcuts() {
      return {
        'Mod-Enter': () => {
          onSubmit?.()
          return true
        },
      }
    },
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Desabilitar heading — não faz parte do escopo de notas
        heading: false,
        // Desabilitar code block
        codeBlock: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-800',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      SubmitOnCtrlEnter,
    ],
    content: value,
    editable: !disabled,
    onUpdate({ editor }) {
      // Entregar HTML vazio como string vazia para facilitar validação
      const html = editor.isEmpty ? '' : editor.getHTML()
      onChange(html)
    },
    editorProps: {
      attributes: {
        class: [
          'min-h-[80px] px-3 py-2 text-sm text-gray-800 focus:outline-none',
          'prose prose-sm max-w-none',
          'prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0',
          disabled ? 'opacity-60 cursor-not-allowed' : '',
        ].join(' '),
        ...(placeholder && { 'data-placeholder': placeholder }),
      },
    },
  })

  // Inserir link via prompt simples
  const handleLink = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL do link:', prev ?? 'https://')
    if (url === null) return
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
    }
  }, [editor])

  if (!editor) return null

  return (
    <div
      className={[
        'border rounded-lg overflow-hidden bg-white',
        disabled
          ? 'border-gray-200 bg-gray-50'
          : 'border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500',
      ].join(' ')}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          disabled={disabled}
          title="Negrito (Ctrl+B)"
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          disabled={disabled}
          title="Itálico (Ctrl+I)"
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          disabled={disabled}
          title="Sublinhado (Ctrl+U)"
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-gray-300 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          disabled={disabled}
          title="Lista com bullets"
        >
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          disabled={disabled}
          title="Lista numerada"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-gray-300 mx-1" />

        <ToolbarButton
          onClick={handleLink}
          active={editor.isActive('link')}
          disabled={disabled}
          title="Inserir link"
        >
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolbarButton>
      </div>

      {/* Área do editor */}
      <EditorContent editor={editor} />
    </div>
  )
}

export default RichTextNoteEditor
