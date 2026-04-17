/**
 * PromptBuilderStepper
 *
 * Indicador visual das etapas do wizard de criação de agentes.
 * Etapa 5 (sucesso) não aparece no indicador.
 */

import { Check } from 'lucide-react'

const STEPS = [
  { n: 1, label: 'Básico' },
  { n: 2, label: 'Dados detectados' },
  { n: 3, label: 'Configuração' },
  { n: 4, label: 'Preview' },
]

interface Props {
  current: number
}

export function PromptBuilderStepper({ current }: Props) {
  if (current <= 0 || current >= 5) return null

  return (
    <div className="flex items-center gap-0">
      {STEPS.map(({ n, label }, idx) => {
        const done = current > n
        const active = current === n

        return (
          <div key={n} className="flex items-center">
            {/* Passo */}
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                done   ? 'bg-green-500 text-white'
                : active ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-400'
              }`}>
                {done ? <Check className="w-3.5 h-3.5" /> : n}
              </div>
              <span className={`text-xs font-medium hidden sm:block transition-colors ${
                active ? 'text-gray-900' : done ? 'text-green-600' : 'text-gray-400'
              }`}>
                {label}
              </span>
            </div>

            {/* Conector */}
            {idx < STEPS.length - 1 && (
              <div className={`h-px mx-3 flex-shrink-0 transition-colors hidden sm:block ${
                current > n ? 'bg-green-400 w-6' : 'bg-gray-200 w-6'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
