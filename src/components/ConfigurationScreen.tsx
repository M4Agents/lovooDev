import React from 'react';
import { AlertCircle, ExternalLink, Settings } from 'lucide-react';

export const ConfigurationScreen: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Settings className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Lovoo CRM</h1>
            <p className="text-gray-600">Analytics Comportamental para Landing Pages</p>
          </div>

          {/* Configuration Notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-8">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-amber-800 mb-2">
                  Configuração Necessária
                </h3>
                <p className="text-amber-700 text-sm mb-4">
                  Para usar o Lovoo CRM, você precisa configurar as variáveis de ambiente do Supabase no Vercel.
                </p>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0">
                1
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Configure o Supabase</h3>
                <p className="text-gray-600 text-sm mb-3">
                  Crie um projeto no Supabase e obtenha suas credenciais de API.
                </p>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Acessar Supabase Dashboard
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0">
                2
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Configure as Variáveis no Vercel</h3>
                <p className="text-gray-600 text-sm mb-3">
                  No dashboard do Vercel, vá em Settings → Environment Variables e adicione:
                </p>
                <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm">
                  <div className="space-y-1">
                    <div><span className="text-blue-600">VITE_SUPABASE_URL</span>=https://seu-projeto.supabase.co</div>
                    <div><span className="text-blue-600">VITE_SUPABASE_ANON_KEY</span>=sua-chave-anon</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0">
                3
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Execute as Migrações</h3>
                <p className="text-gray-600 text-sm mb-3">
                  Execute os scripts SQL da pasta <code className="bg-gray-100 px-1 rounded">supabase/migrations/</code> no seu projeto Supabase.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0">
                4
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Redeploy</h3>
                <p className="text-gray-600 text-sm">
                  Após configurar as variáveis, faça um novo deploy no Vercel para aplicar as mudanças.
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center">
            <p className="text-sm text-gray-500">
              Precisa de ajuda? Consulte a documentação no repositório do projeto.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
