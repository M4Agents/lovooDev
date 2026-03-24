import React, { useEffect, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'

interface DisconnectedInstance {
  instanceName: string
  oldStatus: string
  newStatus: string
}

export const InstanceDisconnectedNotification: React.FC = () => {
  const [notifications, setNotifications] = useState<DisconnectedInstance[]>([])

  useEffect(() => {
    const handleInstanceDisconnected = (event: CustomEvent) => {
      const { instanceName, oldStatus, newStatus } = event.detail
      
      setNotifications(prev => [...prev, { instanceName, oldStatus, newStatus }])
      
      setTimeout(() => {
        setNotifications(prev => prev.slice(1))
      }, 5000)
    }

    window.addEventListener('whatsapp-instance-disconnected', handleInstanceDisconnected as EventListener)

    return () => {
      window.removeEventListener('whatsapp-instance-disconnected', handleInstanceDisconnected as EventListener)
    }
  }, [])

  if (notifications.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map((notification, index) => (
        <div
          key={index}
          className="bg-red-50 border-l-4 border-red-400 p-4 rounded-lg shadow-lg max-w-md animate-slide-in"
        >
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800">
                WhatsApp Desconectado
              </h3>
              <p className="mt-1 text-sm text-red-700">
                A instância <strong>{notification.instanceName}</strong> foi desconectada.
              </p>
              <p className="mt-1 text-xs text-red-600">
                Reconecte em Configurações → Integrações → WhatsApp Life
              </p>
            </div>
            <button
              onClick={() => setNotifications(prev => prev.filter((_, i) => i !== index))}
              className="ml-3 text-red-400 hover:text-red-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
