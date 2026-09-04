// =====================================================
// COMPONENTE: ActivityPromptModal
// DATETIME.2C.2 → DATETIME.2C.4
// Objetivo: Prompt pós-transição para oferecer criação
//           de atividade quando existe datetime flagged.
// 2C.4: Exibir data/hora escolhida em vez do label.
// =====================================================

interface ActivityPromptModalProps {
  isOpen: boolean
  formattedDateTime: string
  onConfirm: () => void
  onCancel: () => void
}

export const ActivityPromptModal: React.FC<ActivityPromptModalProps> = ({
  isOpen,
  formattedDateTime,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-xl font-semibold text-gray-900 mb-3">
          Criar atividade?
        </h2>
        <p className="text-gray-600 mb-6">
          Deseja criar uma atividade no calendário para <span className="font-medium">{formattedDateTime}</span>?
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            Agora não
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors"
          >
            Criar atividade
          </button>
        </div>
      </div>
    </div>
  )
}
