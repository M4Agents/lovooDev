// =====================================================
// COMPONENT: NodeDebugBadge
// Badge visual mínimo para indicar status da última
// execução de um node no canvas.
// =====================================================

import { NodeDebugStatus } from '../../../hooks/useFlowDebug'

const STATUS_CONFIG: Record<
  NonNullable<NodeDebugStatus['status']>,
  { bg: string; label: string }
> = {
  success: { bg: 'bg-green-500',  label: 'Sucesso'   },
  error:   { bg: 'bg-red-500',    label: 'Erro'      },
  paused:  { bg: 'bg-amber-400',  label: 'Pausado'   },
  skipped: { bg: 'bg-gray-400',   label: 'Ignorado'  },
}

interface NodeDebugBadgeProps {
  debugStatus?: NodeDebugStatus | null
}

export default function NodeDebugBadge({ debugStatus }: NodeDebugBadgeProps) {
  if (!debugStatus) return null

  const config = STATUS_CONFIG[debugStatus.status] ?? STATUS_CONFIG.skipped
  const title = debugStatus.error_message
    ? `${config.label}: ${debugStatus.error_message}`
    : config.label

  return (
    <span
      className={`absolute top-0 right-0 translate-x-1/3 -translate-y-1/3 w-3 h-3 rounded-full border-2 border-white z-10 ${config.bg}`}
      title={title}
    />
  )
}
