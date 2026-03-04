import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import ChatArea from '../WhatsAppChat/ChatArea/ChatArea'
import LeadPanel from '../WhatsAppChat/LeadPanel/LeadPanel'
import { chatApi } from '../../services/chat/chatApi'

interface ChatModalSimpleProps {
  isOpen: boolean
  onClose: () => void
  leadId: number
  companyId: string
  userId: string
}

export default function ChatModalSimple({
  isOpen,
  onClose,
  leadId,
  companyId,
  userId
}: ChatModalSimpleProps) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && leadId) {
      loadConversation()
    }
  }, [isOpen, leadId])

  const loadConversation = async () => {
    try {
      setLoading(true)
      setError(null)
      const convId = await chatApi.getConversationByLeadId(leadId, companyId)
      
      if (!convId) {
        setError('Este lead não possui uma conversa ativa no WhatsApp')
        return
      }
      
      setConversationId(convId)
    } catch (err) {
      console.error('Erro ao buscar conversa:', err)
      setError('Erro ao carregar conversa do lead')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden" style={{ width: '85vw', height: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900">Chat do Lead</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Carregando conversa...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md p-8">
                <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{error}</h3>
                <p className="text-sm text-gray-600 mb-4">
                  O lead precisa ter uma conversa ativa no WhatsApp para visualizar o chat.
                </p>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Voltar ao Funil
                </button>
              </div>
            </div>
          ) : conversationId ? (
            <>
              {/* ChatArea - 60% */}
              <div className="flex flex-col bg-white" style={{ width: '60%' }}>
                <ChatArea
                  conversationId={conversationId}
                  companyId={companyId}
                  userId={userId}
                />
              </div>

              {/* LeadPanel - 40% */}
              <div className="bg-white border-l border-gray-200" style={{ width: '40%' }}>
                <LeadPanel
                  conversationId={conversationId}
                  companyId={companyId}
                  userId={userId}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
