import { useEffect } from 'react'
import { X, Trophy } from 'lucide-react'

interface Props {
  onClose: () => void
}

const ROWS: Array<{ label: string; text: string; example: string }> = [
  {
    label: '#',
    text: 'Posição pelo score, do maior para o menor. Quem tem a nota mais alta fica em 1º.',
    example: 'Neste exemplo, um vendedor tem score 32 e outro tem 20. O de 32 fica na linha 1 e o de 20 na linha 2.',
  },
  {
    label: 'Score',
    text: 'Nota de 0 a 100. Abaixo de 45 fica vermelho, de 45 a 69 âmbar e de 70 para cima verde.',
    example: 'Um score 28 é vermelho. Um score 60 é âmbar. Um score 75 é verde.',
  },
  {
    label: 'Leads',
    text: 'Leads criados no período, atribuídos à pessoa, que ainda estão numa etapa ativa do funil. Ganhou e Perdeu ficam de fora. Por padrão entram todos os funis e todas as etapas ativas.',
    example: 'Imagine 100 leads recebidos na semana e 8 que já foram para Perdeu. A coluna mostra 92, os que ainda estão em negociação.',
  },
  {
    label: 'Atend.',
    text: 'Parcela desses leads que enviou mensagem e recebeu resposta humana. Resposta da IA não entra. Lead que não escreveu também entra na conta e reduz o percentual.',
    example: 'Dos 92 leads do exemplo, 14 escreveram e receberam resposta de uma pessoa. 14 ÷ 92 = 15%. Os outros 78 não escreveram e por isso o percentual fica baixo, mesmo com a maioria das conversas respondidas.',
  },
  {
    label: 'T. Resp.',
    text: 'Tempo médio entre a primeira mensagem do lead e a primeira resposta humana, só nas conversas que foram respondidas.',
    example: 'Nas 14 conversas respondidas do exemplo, a primeira resposta humana demorou em média 4 horas. A coluna mostra 4,0h. Quem nunca foi respondido não entra nessa média.',
  },
  {
    label: 'Conversão',
    text: 'O que foi ganho dividido pelo que foi fechado no período (ganho + perdido), nos funis incluídos. Ganhou e Perdeu sempre entram aqui. Sem nenhum fechamento, a conta usa 50% para não punir nem premiar.',
    example: 'Imagine 10 negócios fechados: 2 ganhos e 8 perdidos. 2 ÷ 10 = 20%. Se nenhum tivesse sido fechado, a coluna mostraria 50%.',
  },
  {
    label: 'SLA',
    text: 'Leads novos do período, ainda numa etapa ativa, que escreveram e nunca receberam resposta humana. Ganhou e Perdeu ficam de fora. Esse número não usa o prazo da Fila de Atendimento.',
    example: 'No exemplo, 5 leads escreveram e ninguém respondeu. A coluna mostra 5. Não é a quantidade da Fila de Atendimento e não significa que passaram de 4 horas.',
  },
  {
    label: 'Receita',
    text: 'Soma das oportunidades ganhas com fechamento no período, nos funis incluídos. O traço ao lado mostra a variação recente dessa receita.',
    example: 'Os 2 negócios ganhos do exemplo somam R$ 5.000. A coluna mostra R$ 5.000. Um traço verde subindo indica que essa receita cresceu em relação ao período anterior.',
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
              <p className="text-xs text-gray-500">O que cada coluna significa, com números de exemplo</p>
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

          <section className="space-y-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-amber-950">
            <h4 className="text-sm font-semibold">Exemplo ilustrativo</h4>
            <p>
              Os números abaixo são inventados. Não vêm de nenhuma empresa nem de nenhum vendedor.
              Servem só para mostrar a conta.
            </p>
            <p>
              Imagine 100 leads recebidos. 8 já estão em Perdeu, então Leads mostra 92.
              Desses 92, 14 escreveram e foram respondidos por uma pessoa: Atend. fica em 15%.
              A primeira resposta humana demorou em média 4 horas: T. Resp. mostra 4,0h.
              Cinco leads escreveram e ninguém respondeu: SLA mostra 5.
              Foram fechados 2 ganhos e 8 perdidos: Conversão fica em 20% e Receita soma o valor dos 2 ganhos.
            </p>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-800">Quem aparece</h4>
            <p>
              Membros ativos da empresa nos papéis vendedor, gerente ou admin, com pelo menos um lead criado nesse período ainda em etapa ativa, ou com fechamento no período.
            </p>
            <p>
              Ganhou e Perdeu são fixas: ficam fora de Leads, Atend., T. Resp. e SLA, e continuam em Conversão e Receita. O admin escolhe os demais funis e etapas no botão Configurar.
            </p>
          </section>

          <section className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-800">Colunas</h4>
            <dl className="space-y-4">
              {ROWS.map((row) => (
                <div key={row.label} className="grid grid-cols-1 sm:grid-cols-[5.5rem_1fr] gap-1 sm:gap-3">
                  <dt className="text-xs font-semibold text-gray-800 pt-0.5">{row.label}</dt>
                  <dd className="space-y-1.5">
                    <p>{row.text}</p>
                    <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                      <span className="font-semibold text-gray-700">Exemplo. </span>
                      {row.example}
                    </p>
                  </dd>
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
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <span className="font-semibold text-gray-700">Exemplo. </span>
              No exemplo, 20% de conversão vale cerca de 7 dos 35 pontos.
              15% de atendimento vale cerca de 3 dos 20 pontos.
              Se o mais lento do grupo leva 8 horas e este vendedor leva 4, a velocidade vale cerca de metade dos 25 pontos.
              Quem gera mais oportunidades leva os 10 pontos inteiros dessa parte.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
