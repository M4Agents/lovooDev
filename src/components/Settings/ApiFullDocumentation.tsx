import React, { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Check,
  ShieldCheck,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Utilitários internos
// ---------------------------------------------------------------------------

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };
  return { copied, copy };
}

interface CodeBlockProps {
  id: string;
  code: string;
  language?: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}

function CodeBlock({ id, code, language = 'json', copied, onCopy }: CodeBlockProps) {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between bg-slate-800 rounded-t-lg px-4 py-2">
        <span className="text-xs text-slate-400 font-mono">{language}</span>
        <button
          onClick={() => onCopy(code, id)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
        >
          {copied === id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied === id ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
      <pre className="bg-slate-900 text-slate-100 text-xs p-4 rounded-b-lg overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, icon, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {icon}
          <span className="text-sm font-semibold text-slate-800">{title}</span>
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-400" />
          : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-5 py-5 space-y-4 text-sm text-slate-700 border-t border-slate-200">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conteúdo da documentação (public-safe by design)
// ---------------------------------------------------------------------------

const EXAMPLE_REQUEST = `curl -X POST /api/webhook-lead \\
  -H "Content-Type: application/json" \\
  -d '{
    "api_key": "SUA_API_KEY",
    "name": "João Silva",
    "email": "exemplo@email.com",
    "phone": "5511999999999",
    "interesse": "Plano Empresarial",
    "utm_source": "google",
    "utm_medium": "cpc",
    "tags": "lead-quente,site"
  }'`;

const EXAMPLE_SUCCESS = `HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "lead_id": 12345,
  "status": "created"
}`;

const EXAMPLE_DUPLICATE = `HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "lead_id": 12345,
  "status": "duplicate"
}`;

const EXAMPLE_ERROR_AUTH = `HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "invalid_key",
  "message": "Chave de API inválida ou ausente."
}`;

const EXAMPLE_ERROR_VALIDATION = `HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "validation_error",
  "message": "Email inválido e nenhum telefone fornecido."
}`;

const EXAMPLE_ERROR_RATE = `HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
  "error": "rate_limited",
  "message": "Limite de requisições excedido. Aguarde antes de tentar novamente."
}`;

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export const ApiFullDocumentation: React.FC = () => {
  const { copied, copy } = useCopy();

  return (
    <div className="space-y-3">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-indigo-100 rounded-lg">
          <BookOpen className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Documentação Completa da API</h2>
          <p className="text-sm text-slate-500">
            Referência técnica para integração via API de importação de leads
          </p>
        </div>
      </div>

      {/* Aviso de segurança */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          Nunca compartilhe sua <strong>API Key</strong> publicamente. Trate-a como uma senha.
          Em caso de comprometimento, entre em contato com o suporte para geração de nova chave.
        </span>
      </div>

      {/* 1. Introdução */}
      <Section
        title="1. Introdução"
        icon={<Info className="w-4 h-4 text-blue-500" />}
        defaultOpen
      >
        <p>
          A API de importação de leads permite enviar contatos de sistemas externos diretamente
          para o Lovoo CRM. Cada requisição cria ou identifica um lead na empresa associada à
          chave de API fornecida.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>Um lead por requisição</li>
          <li>Autenticação por chave de API no corpo da requisição</li>
          <li>Deduplicação automática por telefone e e-mail</li>
          <li>Campos extras e tags processados automaticamente</li>
          <li>Todos os resultados ficam registrados nos Logs de Importação</li>
        </ul>
      </Section>

      {/* 2. Autenticação */}
      <Section
        title="2. Autenticação"
        icon={<ShieldCheck className="w-4 h-4 text-emerald-500" />}
      >
        <p>
          A autenticação é feita pelo campo <code className="bg-slate-100 px-1 rounded">api_key</code> no
          corpo JSON da requisição. Não é necessário nenhum cabeçalho de autorização adicional.
        </p>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-700">
          {"{ \"api_key\": \"SUA_API_KEY\", ... }"}
        </div>
        <p className="text-slate-500 text-xs">
          Sua API Key está disponível na aba <strong>Credenciais</strong> desta seção.
        </p>
      </Section>

      {/* 3. Endpoint */}
      <Section
        title="3. Endpoint"
        icon={<Zap className="w-4 h-4 text-yellow-500" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">URL</p>
            <code className="block bg-slate-100 px-3 py-2 rounded-lg text-sm text-slate-800">
              /api/webhook-lead
            </code>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Método</p>
            <code className="block bg-blue-100 text-blue-800 px-3 py-2 rounded-lg text-sm font-bold">
              POST
            </code>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Content-Type</p>
            <code className="block bg-slate-100 px-3 py-2 rounded-lg text-sm text-slate-800">
              application/json
            </code>
          </div>
        </div>
        <p className="text-slate-500 text-xs mt-2">
          A URL base depende do ambiente. Em produção, use a URL completa do seu domínio.
        </p>
      </Section>

      {/* 4. Payload mínimo */}
      <Section
        title="4. Payload mínimo"
        icon={<Code2 className="w-4 h-4 text-purple-500" />}
      >
        <p>
          O payload deve ser um objeto JSON com pelo menos um dos campos identificadores:
          <strong> nome</strong>, <strong>e-mail</strong> ou <strong>telefone</strong>.
        </p>
        <CodeBlock
          id="payload-min"
          language="json"
          code={`{
  "api_key": "SUA_API_KEY",
  "name": "João Silva",
  "email": "exemplo@email.com",
  "phone": "5511999999999"
}`}
          copied={copied}
          onCopy={copy}
        />
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          A API aceita apenas <strong>um lead por requisição</strong>. Payloads com arrays ou
          múltiplos leads são rejeitados com erro 400.
        </div>
      </Section>

      {/* 5. Campos aceitos */}
      <Section
        title="5. Campos aceitos"
        icon={<CheckCircle2 className="w-4 h-4 text-teal-500" />}
      >
        <p className="text-slate-600">
          O sistema reconhece automaticamente variações de nomes de campo. Use qualquer
          dos aliases listados abaixo.
        </p>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-blue-50 px-4 py-2 border-b border-slate-200">
            <p className="text-xs font-semibold text-blue-800">Dados do lead</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Campo</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Aliases aceitos</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Limite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ['Nome', 'name, nome, full_name, fullname, first_name, cliente, usuario', '255 caracteres'],
                  ['E-mail', 'email, e-mail, mail, email_address, user_email', '255 caracteres'],
                  ['Telefone', 'phone, telefone, tel, celular, whatsapp, mobile', '30 caracteres'],
                  ['Interesse', 'interest, interesse, subject, assunto, message, mensagem', '500 caracteres'],
                  ['Empresa do lead', 'company, empresa, company_name, nome_empresa', '255 caracteres'],
                  ['CNPJ', 'cnpj, company_cnpj, documento', '20 caracteres'],
                  ['Origem', 'utm_source, origin, origem, source, fonte', '255 caracteres'],
                  ['Mídia', 'utm_medium, medium, midia', '100 caracteres'],
                  ['Campanha', 'utm_campaign, campanha, campaign', '255 caracteres'],
                  ['Tags', 'tags, tag, etiquetas', 'Array ou string separada por vírgula'],
                  ['Referência externa', 'ref, reference, external_id, id_externo', '255 caracteres'],
                  ['Visitor ID', 'visitor_id, session_id', '128 caracteres'],
                ].map(([campo, aliases, limite]) => (
                  <tr key={campo} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">{campo}</td>
                    <td className="px-4 py-2 font-mono text-slate-600">{aliases}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{limite}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden mt-3">
          <div className="bg-orange-50 px-4 py-2 border-b border-slate-200">
            <p className="text-xs font-semibold text-orange-800">Campos personalizados (custom fields)</p>
          </div>
          <div className="px-4 py-3 text-xs text-slate-600 space-y-1">
            <p>
              Campos personalizados são enviados usando o <strong>ID numérico</strong> do campo
              como chave. Você encontra o ID de cada campo em{' '}
              <em>Configurações → Sistema → Campos Personalizados</em>.
            </p>
            <CodeBlock
              id="custom-fields"
              language="json"
              code={`{
  "api_key": "SUA_API_KEY",
  "name": "João Silva",
  "42": "Valor do campo personalizado 42",
  "7": "Outro valor"
}`}
              copied={copied}
              onCopy={copy}
            />
            <p className="text-slate-500">
              Limite: até 20 campos personalizados por requisição. Cada valor: até 500 caracteres.
            </p>
          </div>
        </div>
      </Section>

      {/* 6. Campos não permitidos */}
      <Section
        title="6. Campos não permitidos"
        icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
      >
        <p>
          Os campos abaixo são <strong>bloqueados</strong>. Requisições que os contenham retornam
          erro 400 imediatamente.
        </p>
        <div className="flex flex-wrap gap-2">
          {['company_id', 'user_id', 'role', 'permissions', 'plan_id',
            'is_admin', 'is_active', 'password', 'token', 'secret',
            'authorization', 'jwt', 'deleted_at', 'created_at', 'updated_at',
          ].map(f => (
            <code key={f} className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded text-xs">
              {f}
            </code>
          ))}
        </div>
        <p className="text-slate-500 text-xs">
          Campos desconhecidos (fora da lista de aceitos) são descartados silenciosamente —
          não causam erro, mas não são processados.
        </p>
      </Section>

      {/* 7. Normalização automática */}
      <Section
        title="7. Normalização automática"
        icon={<CheckCircle2 className="w-4 h-4 text-cyan-500" />}
      >
        <p>A API normaliza automaticamente os seguintes campos antes de salvar:</p>
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Campo</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Normalização aplicada</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Exemplo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-2 font-medium">Nome</td>
                <td className="px-4 py-2 text-slate-600">Remove espaços duplicados nas bordas e entre palavras</td>
                <td className="px-4 py-2 font-mono text-slate-500">"João  Silva" → "João Silva"</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium">E-mail</td>
                <td className="px-4 py-2 text-slate-600">Converte para letras minúsculas e remove espaços</td>
                <td className="px-4 py-2 font-mono text-slate-500">"JOAO@Email.com" → "joao@email.com"</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium">Telefone</td>
                <td className="px-4 py-2 text-slate-600">Remove espaços nas bordas</td>
                <td className="px-4 py-2 font-mono text-slate-500">" 5511999999999 " → "5511999999999"</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-slate-500 text-xs">
          UTMs, referências externas e IDs não sofrem normalização automática — são preservados exatamente como enviados.
        </p>
      </Section>

      {/* 8. Validações */}
      <Section
        title="8. Validações"
        icon={<ShieldCheck className="w-4 h-4 text-violet-500" />}
      >
        <ul className="space-y-2 text-slate-700">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Identificador obrigatório:</strong> ao menos um dos campos nome, e-mail ou telefone deve estar presente.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>E-mail inválido com telefone:</strong> o e-mail é descartado e o lead é criado com telefone.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>E-mail inválido sem telefone:</strong> a requisição retorna erro 400.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Tamanho máximo do payload:</strong> 10 KB. Payloads maiores retornam erro 413.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Um lead por requisição:</strong> arrays no body são rejeitados com erro 400.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Objetos aninhados:</strong> não são aceitos (exceto tags como array de strings).</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Limite de campos:</strong> máximo de 50 campos por requisição.</span>
          </li>
        </ul>
      </Section>

      {/* 9. Rate limit */}
      <Section
        title="9. Proteção contra abuso (Rate Limit)"
        icon={<ShieldCheck className="w-4 h-4 text-orange-500" />}
      >
        <p>
          A API possui proteção automática contra uso abusivo e excesso de requisições.
          Quando o limite é atingido, a API retorna o código HTTP <strong>429</strong>.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>A proteção opera em múltiplas janelas de tempo</li>
          <li>É aplicada por empresa e por chave de API</li>
          <li>Requisições bloqueadas ficam registradas nos Logs de Importação</li>
        </ul>
        <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-100 rounded text-xs text-orange-700">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Ao receber erro 429, implemente <strong>retry com backoff exponencial</strong>:
          aguarde alguns segundos antes de tentar novamente, dobrando o tempo a cada tentativa.
        </div>
      </Section>

      {/* 10. Limite do plano */}
      <Section
        title="10. Limite do plano"
        icon={<AlertTriangle className="w-4 h-4 text-purple-500" />}
      >
        <p>
          O número de leads que podem ser importados depende do plano contratado pela empresa.
          Ao atingir o limite, a API retorna o código HTTP <strong>403</strong> com
          o código de erro <code className="bg-slate-100 px-1 rounded">plan_limit</code>.
        </p>
        <p className="text-slate-500">
          Para verificar ou ampliar seu limite, acesse <em>Configurações → Planos e Uso</em>.
        </p>
      </Section>

      {/* 11. Deduplicação */}
      <Section
        title="11. Deduplicação"
        icon={<CheckCircle2 className="w-4 h-4 text-sky-500" />}
      >
        <p>
          Se um lead com o mesmo <strong>telefone</strong> ou <strong>e-mail</strong> já existir
          na empresa, a API retorna status <code className="bg-slate-100 px-1 rounded">duplicate</code>
          {' '}e o ID do lead existente — sem criar um novo registro.
        </p>
        <p className="text-slate-600">
          A resposta HTTP continua sendo <strong>200</strong> (não é um erro), mas o campo
          {' '}<code className="bg-slate-100 px-1 rounded">status</code> na resposta indica
          {' '}<code className="bg-slate-100 px-1 rounded">"duplicate"</code>.
        </p>
      </Section>

      {/* 12. Códigos de erro */}
      <Section
        title="12. Códigos de resposta"
        icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
      >
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">HTTP</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Código</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Descrição</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ['200', 'success / duplicate', 'Lead criado ou duplicata identificada com sucesso'],
                ['400', 'validation_error', 'Payload inválido (campo bloqueado, e-mail inválido sem telefone, array recebido, etc.)'],
                ['401', 'invalid_key', 'Chave de API ausente ou inválida'],
                ['403', 'company_inactive', 'Empresa suspensa ou cancelada'],
                ['403', 'plan_limit', 'Limite de leads do plano atingido'],
                ['413', 'payload_too_large', 'Payload acima de 10 KB'],
                ['429', 'rate_limited', 'Muitas requisições em um curto período'],
                ['500', 'error', 'Erro interno. Tente novamente em instantes'],
              ].map(([code, name, desc]) => (
                <tr key={`${code}-${name}`} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono font-bold text-slate-800">{code}</td>
                  <td className="px-4 py-2 font-mono text-slate-600">{name}</td>
                  <td className="px-4 py-2 text-slate-600">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 13. Logs */}
      <Section
        title="13. Logs de importação"
        icon={<Info className="w-4 h-4 text-teal-500" />}
      >
        <p>
          Cada tentativa de importação — bem-sucedida ou não — fica registrada nos
          {' '}<strong>Logs de Importação</strong> (aba ao lado).
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>Status da tentativa (sucesso, erro, duplicata, rate limited, limite do plano)</li>
          <li>Identificação do lead (nome, e-mail ou telefone, sem dados completos)</li>
          <li>Mensagem de erro quando aplicável</li>
          <li>Referência externa enviada (se informada)</li>
          <li>Data e hora da tentativa</li>
        </ul>
        <p className="text-slate-500 text-xs">
          Acesso aos logs restrito a administradores da empresa.
        </p>
      </Section>

      {/* 14. Boas práticas */}
      <Section
        title="14. Boas práticas de integração"
        icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
      >
        <ul className="space-y-3 text-slate-700">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Nunca exponha a API Key:</strong> trate-a como credencial privada. Não inclua em código-fonte público ou logs.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Use retry com backoff:</strong> para erros 429 e 500, aguarde antes de tentar novamente (ex: 2s, 4s, 8s).</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Trate duplicatas como sucesso:</strong> código 200 com <code className="bg-slate-100 px-1 rounded">status: "duplicate"</code> não é falha.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Envie apenas dados necessários:</strong> evite campos extras desnecessários. Campos desconhecidos são ignorados mas ocupam espaço.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Use <code className="bg-slate-100 px-1 rounded">ref</code> / <code className="bg-slate-100 px-1 rounded">external_id</code>:</strong> enviar um identificador externo facilita rastrear a origem nos logs.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Monitore os logs:</strong> consulte os Logs de Importação periodicamente para detectar falhas de integração.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
            <span><strong>Não envie dados sensíveis:</strong> senhas, tokens, dados financeiros ou informações pessoais além do necessário para identificar o lead.</span>
          </li>
        </ul>
      </Section>

      {/* 15. Exemplos */}
      <Section
        title="15. Exemplos"
        icon={<Code2 className="w-4 h-4 text-indigo-500" />}
      >
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Requisição completa (cURL)
            </p>
            <CodeBlock
              id="example-curl"
              language="bash"
              code={EXAMPLE_REQUEST}
              copied={copied}
              onCopy={copy}
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Resposta — lead criado
            </p>
            <CodeBlock
              id="example-success"
              language="http"
              code={EXAMPLE_SUCCESS}
              copied={copied}
              onCopy={copy}
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Resposta — duplicata identificada
            </p>
            <CodeBlock
              id="example-duplicate"
              language="http"
              code={EXAMPLE_DUPLICATE}
              copied={copied}
              onCopy={copy}
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Erro — chave inválida (401)
            </p>
            <CodeBlock
              id="example-401"
              language="http"
              code={EXAMPLE_ERROR_AUTH}
              copied={copied}
              onCopy={copy}
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Erro — validação (400)
            </p>
            <CodeBlock
              id="example-400"
              language="http"
              code={EXAMPLE_ERROR_VALIDATION}
              copied={copied}
              onCopy={copy}
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Erro — rate limit (429)
            </p>
            <CodeBlock
              id="example-429"
              language="http"
              code={EXAMPLE_ERROR_RATE}
              copied={copied}
              onCopy={copy}
            />
          </div>
        </div>
      </Section>
    </div>
  );
};
