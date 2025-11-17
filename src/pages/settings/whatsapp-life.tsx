// =====================================================
// PÁGINA: WHATSAPP LIFE SETTINGS
// =====================================================
// Página isolada para configurações do WhatsApp Life

import React from 'react';
import { WhatsAppLifeModule } from '../../components/WhatsAppLife/WhatsAppLifeModule';

// =====================================================
// COMPONENTE DA PÁGINA
// =====================================================
export default function WhatsAppLifePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header da Página */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <nav className="flex" aria-label="Breadcrumb">
              <ol className="flex items-center space-x-4">
                <li>
                  <div>
                    <a href="/dashboard" className="text-gray-400 hover:text-gray-500">
                      Dashboard
                    </a>
                  </div>
                </li>
                <li>
                  <div className="flex items-center">
                    <svg
                      className="flex-shrink-0 h-5 w-5 text-gray-300"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path d="M5.555 17.776l8-16 .894.448-8 16-.894-.448z" />
                    </svg>
                    <a href="/settings" className="ml-4 text-gray-400 hover:text-gray-500">
                      Configurações
                    </a>
                  </div>
                </li>
                <li>
                  <div className="flex items-center">
                    <svg
                      className="flex-shrink-0 h-5 w-5 text-gray-300"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path d="M5.555 17.776l8-16 .894.448-8 16-.894-.448z" />
                    </svg>
                    <span className="ml-4 text-gray-500">WhatsApp</span>
                  </div>
                </li>
              </ol>
            </nav>
            
            <div className="mt-4">
              <h1 className="text-2xl font-bold text-gray-900">
                WhatsApp Business
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                Configure e gerencie suas conexões WhatsApp para atendimento integrado
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <WhatsAppLifeModule />
      </div>
    </div>
  );
}
