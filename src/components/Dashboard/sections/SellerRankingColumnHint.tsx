import { Info } from 'lucide-react'

export const COLUMN_HINTS = {
  rank: 'Posição pelo score, do maior para o menor.',
  seller: 'Pessoa ativa da empresa, nos papéis vendedor, gerente ou admin, com lead ainda em negociação no período ou com algum fechamento nesse período.',
  score: 'Nota de 0 a 100. Junta conversão (35%), velocidade de resposta (25%), atendimento (20%), oportunidades geradas (10%) e SLA (10%). Abaixo de 45 fica vermelho, de 45 a 69 âmbar e de 70 para cima verde. A velocidade compara com o mais lento do grupo: responder mais rápido vale mais.',
  leads: 'Leads criados no período que ainda estão numa etapa ativa do funil. Quem já foi para Ganhou ou Perdeu não entra nesta coluna.',
  attendance: 'Percentual desses leads que escreveu e recebeu resposta de uma pessoa. Resposta da IA não conta. Lead que não escreveu entra na conta e reduz o percentual. A seta compara com o período anterior: subir é melhor.',
  response: 'Tempo médio entre a primeira mensagem do lead e a primeira resposta humana, só nas conversas que foram respondidas. A seta compara com o período anterior: descer é melhor.',
  conversion: 'O que foi ganho dividido pelo que foi fechado no período (ganho + perdido). Ganhou e Perdeu entram aqui. Sem nenhum fechamento, a coluna mostra 50%.',
  sla: 'Quantidade de leads novos do período, ainda numa etapa ativa, que escreveram e nunca receberam resposta humana. Não usa o prazo da Fila de Atendimento.',
  revenue: 'Soma do valor das oportunidades ganhas com fechamento no período. O traço ao lado mostra se essa receita subiu ou desceu recentemente.',
}

export function ColumnHint({
  label,
  hint,
  name,
  align = 'center',
}: {
  label: string
  hint: string
  name?: string
  align?: 'start' | 'center' | 'end'
}) {
  const panelAlign = align === 'start'
    ? 'left-0'
    : align === 'end'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2'

  return (
    <span className="relative inline-flex items-center gap-1 group">
      <span>{label}</span>
      <button
        type="button"
        className="inline-flex border-0 bg-transparent p-0 cursor-help text-gray-300 hover:text-indigo-500 focus:text-indigo-500 focus:outline-none"
        aria-label={`Como funciona a coluna ${name ?? label}`}
      >
        <Info className="w-3 h-3" />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-1.5 hidden w-64 whitespace-normal rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-[11px] font-normal leading-snug text-gray-600 shadow-lg group-hover:block group-focus-within:block ${panelAlign}`}
      >
        {hint}
      </span>
    </span>
  )
}
