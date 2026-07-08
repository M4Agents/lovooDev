// =====================================================
// ContactCycleHelpModal
//
// Documentação inline do Motor de Ciclos de Contato.
// Exibida ao clicar no ícone de ajuda (?) na seção de configurações.
// =====================================================

import React from 'react'
import {
  X,
  RefreshCw,
  MessageSquare,
  HelpCircle,
  Settings2,
  Zap,
  ToggleRight,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from 'lucide-react'

interface Props {
  onClose: () => void
}

interface SectionProps {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}

const DocSection: React.FC<SectionProps> = ({ icon, title, children }) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
      <span className="text-indigo-500">{icon}</span>
      <h4 className="text-sm font-bold text-slate-800">{title}</h4>
    </div>
    <div className="space-y-2 text-sm text-slate-600">{children}</div>
  </div>
)

const Tag: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
    {children}
  </span>
)

export const ContactCycleHelpModal: React.FC<Props> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Como funciona o Motor de Ciclos de Contato
              </h3>
              <p className="text-xs text-slate-500">Guia completo de configuração e uso</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body com scroll */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-7">

          {/* O que é */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800 leading-relaxed">
            <p className="font-semibold mb-1">O que é o Motor de Ciclos de Contato?</p>
            <p>
              É um sistema que registra automaticamente cada vez que um vendedor tenta contato com
              um lead via WhatsApp. Ele organiza as tentativas em <strong>ciclos</strong> e
              controla quando uma nova tentativa pode ser feita, evitando contatos excessivos e
              garantindo rastreabilidade do processo comercial.
            </p>
          </div>

          {/* Fluxo */}
          <DocSection icon={<Zap className="w-4 h-4" />} title="Como funciona na prática">
            <div className="flex flex-col gap-1.5">
              {[
                'Vendedor envia uma mensagem WhatsApp para o lead',
                'Mensagem enviada com sucesso',
                'Sistema verifica se a etapa do funil rastreia tentativas',
                'Se elegível, o modal de tentativa abre automaticamente',
                'Vendedor seleciona o motivo, responde perguntas (se ativado) e confirma',
                'Tentativa registrada — ciclo permanece aberto para próximas tentativas',
                'Quando o lead responde ou a oportunidade é fechada, o ciclo se encerra',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-slate-700">{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 p-3 bg-slate-50 rounded-lg text-xs text-slate-500 italic">
              O modal <strong>nunca bloqueia</strong> o envio da mensagem. Fechar sem registrar é
              sempre permitido — a mensagem já foi enviada.
            </div>
          </DocSection>

          {/* Configuração */}
          <DocSection icon={<Settings2 className="w-4 h-4" />} title="Aba: Configuração">
            <div className="space-y-3">
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">

                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800">Módulo ativo</span>
                    <Tag color="bg-emerald-50 text-emerald-700">toggle</Tag>
                  </div>
                  <p>Liga ou desliga o motor para toda a empresa. Quando desativado, nenhuma tentativa é registrada e o modal não abre.</p>
                </div>

                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800">Regra de elegibilidade</span>
                    <Tag color="bg-blue-50 text-blue-700">select</Tag>
                  </div>
                  <p className="mb-2">Define quando uma nova tentativa é permitida após o fechamento do ciclo anterior:</p>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-start gap-2">
                      <ChevronRight className="w-3 h-3 mt-0.5 text-indigo-400 flex-shrink-0" />
                      <span><strong>Intervalo em horas</strong> — nova tentativa permitida após X horas do fechamento do ciclo anterior.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ChevronRight className="w-3 h-3 mt-0.5 text-indigo-400 flex-shrink-0" />
                      <span><strong>Virada de dia</strong> — nova tentativa permitida a partir do dia seguinte ao fechamento.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ChevronRight className="w-3 h-3 mt-0.5 text-indigo-400 flex-shrink-0" />
                      <span><strong>Horas + virada de dia</strong> — ambas as condições precisam ser satisfeitas.</span>
                    </div>
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800">Intervalo mínimo (horas)</span>
                    <Tag color="bg-blue-50 text-blue-700">número</Tag>
                  </div>
                  <p>Visível quando a regra usa horas. Mínimo 1h. Exemplo: <strong>4h</strong> significa que só é possível iniciar um novo ciclo 4 horas após o fechamento do anterior.</p>
                </div>

                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800">Exibir perguntas adicionais</span>
                    <Tag color="bg-emerald-50 text-emerald-700">toggle</Tag>
                  </div>
                  <p>Quando ativo, as perguntas configuradas na aba <strong>Perguntas</strong> aparecem no modal de registro de tentativa.</p>
                </div>

              </div>
            </div>
          </DocSection>

          {/* Motivos */}
          <DocSection icon={<MessageSquare className="w-4 h-4" />} title="Aba: Motivos">
            <p>
              Motivos são a <strong>classificação do canal ou razão</strong> da tentativa de contato.
              O vendedor escolhe <strong>um único motivo</strong> ao registrar cada tentativa.
            </p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Exemplos de motivos</p>
              {['WhatsApp', 'Ligação', 'E-mail', 'Visita presencial', 'Reunião online'].map(m => (
                <div key={m} className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                  <span className="text-xs text-slate-700">{m}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
                <p className="font-semibold text-emerald-700 mb-1">Admin pode</p>
                <p className="text-emerald-600">Criar, editar, ativar e desativar motivos</p>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-2.5">
                <p className="font-semibold text-amber-700 mb-1">Seller vê</p>
                <p className="text-amber-600">Apenas motivos ativos no modal</p>
              </div>
            </div>
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Ao ativar o módulo pela primeira vez, motivos padrão são criados automaticamente para a empresa.</span>
            </div>
          </DocSection>

          {/* Perguntas */}
          <DocSection icon={<HelpCircle className="w-4 h-4" />} title="Aba: Perguntas">
            <p>
              Perguntas coletam <strong>informações estruturadas</strong> sobre o que aconteceu durante
              o contato. São respondidas no mesmo modal da tentativa, após o motivo.
            </p>
            <p className="text-xs text-slate-500">
              Aparecem somente se <strong>"Exibir perguntas adicionais"</strong> estiver ativo na Configuração.
            </p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Exemplos de perguntas</p>
              {[
                { label: 'O cliente atendeu?', type: 'Sim/Não', color: 'bg-purple-50 text-purple-700' },
                { label: 'Qual foi a objeção?', type: 'Lista', color: 'bg-blue-50 text-blue-700' },
                { label: 'Próximo passo combinado', type: 'Texto livre', color: 'bg-slate-100 text-slate-600' },
                { label: 'Nível de interesse (1 a 5)', type: 'Texto livre', color: 'bg-slate-100 text-slate-600' },
              ].map(q => (
                <div key={q.label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-700">{q.label}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${q.color}`}>{q.type}</span>
                </div>
              ))}
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              <div className="px-3 py-2.5 flex items-start gap-2">
                <ChevronRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold text-slate-700">Tipo Texto livre</span>
                  <p className="text-xs text-slate-500">Campo aberto para qualquer resposta. Ideal para observações.</p>
                </div>
              </div>
              <div className="px-3 py-2.5 flex items-start gap-2">
                <ChevronRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold text-slate-700">Tipo Lista</span>
                  <p className="text-xs text-slate-500">Opções pré-definidas. Você cadastra as opções ao criar a pergunta.</p>
                </div>
              </div>
              <div className="px-3 py-2.5 flex items-start gap-2">
                <ChevronRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold text-slate-700">Tipo Sim/Não</span>
                  <p className="text-xs text-slate-500">Resposta binária. Útil para perguntas objetivas.</p>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Perguntas marcadas como <strong>obrigatórias</strong> bloqueiam o botão "Registrar tentativa" — mas nunca impedem o fechamento do modal.</span>
            </div>
          </DocSection>

          {/* Etapas do funil */}
          <DocSection icon={<ToggleRight className="w-4 h-4" />} title="Ativar por etapa do funil">
            <p>
              O motor só funciona em etapas onde o rastreamento foi ativado. Isso permite
              que a empresa controle <strong>em quais etapas do processo comercial</strong> as
              tentativas devem ser registradas.
            </p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-2 text-xs">
              <p className="font-semibold text-slate-600 mb-1">Como ativar:</p>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-4 h-4 bg-indigo-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">1</span>
                <span>Acesse o Funil de Vendas</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-4 h-4 bg-indigo-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">2</span>
                <span>Edite a etapa desejada (somente admin)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-4 h-4 bg-indigo-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">3</span>
                <span>Ative o toggle <strong>"Rastrear tentativas de contato"</strong></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-4 h-4 bg-indigo-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">4</span>
                <span>Salve — o motor passa a funcionar para oportunidades nessa etapa</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5 text-xs">
              {[
                { label: 'Lead movido para etapa sem rastreamento', result: 'Ciclo fechado automaticamente', color: 'text-amber-600 bg-amber-50 border-amber-100' },
                { label: 'Lead movido para etapa Ganhou ou Perdeu', result: 'Ciclo fechado automaticamente', color: 'text-amber-600 bg-amber-50 border-amber-100' },
                { label: 'Lead responde a mensagem (webhook)', result: 'Ciclo fechado — lead respondeu', color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
              ].map(item => (
                <div key={item.label} className={`flex items-center justify-between gap-2 border rounded-lg px-3 py-2 ${item.color}`}>
                  <span>{item.label}</span>
                  <span className="font-semibold flex-shrink-0">{item.result}</span>
                </div>
              ))}
            </div>
          </DocSection>

          {/* Diferença motivos x perguntas */}
          <DocSection icon={<MessageSquare className="w-4 h-4" />} title="Motivos × Perguntas — qual a diferença?">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 border border-slate-200"></th>
                    <th className="text-left px-3 py-2 font-semibold text-indigo-700 border border-slate-200">Motivos</th>
                    <th className="text-left px-3 py-2 font-semibold text-purple-700 border border-slate-200">Perguntas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    ['Pergunta que responde', '"Por qual canal tentei?"', '"O que aconteceu?"'],
                    ['Quantidade por tentativa', '1 (escolha única)', 'Múltiplas'],
                    ['Obrigatoriedade', 'Opcional', 'Configurável por pergunta'],
                    ['Tipos disponíveis', 'Texto (label)', 'Texto, lista, sim/não'],
                    ['Aparece quando', 'Sempre no modal', 'Se "perguntas adicionais" ativo'],
                    ['Valor analítico', 'Distribuição por canal', 'Taxa de resposta, objeções'],
                  ].map(([field, a, b]) => (
                    <tr key={field} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-600 border border-slate-200">{field}</td>
                      <td className="px-3 py-2 text-slate-700 border border-slate-200">{a}</td>
                      <td className="px-3 py-2 text-slate-700 border border-slate-200">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DocSection>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Motor de Ciclos de Contato — Lovoo CRM
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            Entendi
          </button>
        </div>

      </div>
    </div>
  )
}
