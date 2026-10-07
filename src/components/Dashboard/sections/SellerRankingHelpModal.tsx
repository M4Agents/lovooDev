import { useEffect } from 'react'
import { X, Trophy } from 'lucide-react'

interface Props {
  onClose: () => void
}

const ROWS: Array<{ label: string; text: string }> = [
  {
    label: '#',
    text: 'Posição pelo score, do maior para o menor.',
  },
  {
    label: 'Score',
    text: 'Nota de 0 a 100. Abaixo de 45 fica vermelho, de 45 a 69 âmbar e de 70 para cima verde.',
  },
  {
    label: 'Leads',
    text: 'Leads criados no período e atribuídos à pessoa que ainda estão numa etapa ativa do funil. Ganhou e Perdeu ficam de fora. Por padrão entram todos os funis e todas as etapas ativas.',
  },
  {
    label: 'Atend.',
    text: 'Parcela desses leads que enviou mensagem e recebeu resposta humana. Resposta da IA não entra. Lead que não escreveu também entra na conta e reduz o percentual.',
  },
  {
    label: 'T. Resp.',
    text: 'Tempo médio entre a primeira mensagem do lead e a primeira resposta humana, só nas conversas que foram respondidas.',
  },
  {
    label: 'Conversão',
    text: 'O que foi ganho dividido pelo que foi fechado no período (ganho + perdido), nos funis incluídos. Ganhou e Perdeu sempre entram aqui. Sem nenhum fechamento, a conta usa 50% para não punir nem premiar.',
  },
  {
    label: 'SLA',
    text: 'Leads novos do período, ainda numa etapa ativa escolhida, que escreveram e nunca receberam resposta humana. Ganhou e Perdeu ficam de fora. Esse número não usa o prazo da Fila de Atendimento.',
  },
  {
    label: 'Receita',
    text: 'Soma das oportunidades ganhas com fechamento no período, nos funis incluídos. O traço ao lado mostra a variação recente dessa receita.',
  },
]

export function SellerRankingHelpModal({ onClose }: Props) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-ranking-help-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
              <Trophy className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h3 id="seller-ranking-help-title" className="text-base font-bold text-gray-900">
                Como ler o Ranking Comercial
              </h3>
              <p className="text-xs text-gray-500">O que cada coluna significa</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6 text-sm text-gray-600 leading-relaxed">
          <p>
            Compara quem recebeu lead no período escolhido no filtro do dashboard.
            Na visão da equipe, a lista segue o score. Na sua visão individual, a posição e o score ficam ocultos.
          </p>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-800">Quem aparece</h4>
            <p>
              Membros ativos da empresa nos papéis vendedor, gerente ou admin, com pelo menos um lead criado nesse período ainda em etapa ativa, ou com fechamento no período.
            </p>
            <p>
              Ganhou e Perdeu são fixas: ficam fora de Leads, Atend., T. Resp. e SLA, e continuam em Conversão e Receita. O admin da empresa escolhe os demais funis e etapas na engrenagem.
            </p>
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-800">Colunas</h4>
            <dl className="space-y-3">
              {ROWS.map((row) => (
                <div key={row.label} className="grid grid-cols-[5.5rem_1fr] gap-3">
                  <dt className="text-xs font-semibold text-gray-800 pt-0.5">{row.label}</dt>
                  <dd>{row.text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-800">Como o score é montado</h4>
            <p>Conversão 35%, velocidade de resposta 25%, atendimento 20%, oportunidades geradas 10% e SLA 10%.</p>
            <p>
              A velocidade compara com o mais lento do grupo: responder mais rápido vale mais.
              Oportunidade gerada não tem coluna. Ela entra só no score, em relação a quem gerou mais.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
