import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { GameInstance, ContextMenuTypeOrNull, Version } from '../../types'

interface OverviewProps {
  instance: GameInstance
  options: ContextMenuTypeOrNull
  offline: boolean
  playing: boolean
  versions: Version[]
  installed: boolean
}

const Overview: React.FC<OverviewProps> = ({ instance }) => {
  const [stats, setStats] = useState({
    mods: 0,
    worlds: 0,
    servers: 0,
    size: '0 MB'
  })
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    const loadStats = async () => {
      try {
        // Carregar estatísticas e status
        const [mods, worlds, servers, running] = await Promise.all([
          invoke<string[]>('get_installed_mods', { instanceId: instance.id }),
          invoke<any[]>('get_worlds', { instanceId: instance.id }),
          invoke<any[]>('get_servers', { instanceId: instance.id }),
          invoke<boolean>('is_instance_running', { instanceId: instance.id })
        ])

        // Calcular tamanho aproximado (simplificado)
        const modsSize = mods.length * 5 // 5MB por mod aproximadamente
        const worldsSize = worlds.length * 50 // 50MB por mundo aproximadamente

        setStats({
          mods: mods.length,
          worlds: worlds.length,
          servers: servers.length,
          size: `${modsSize + worldsSize} MB`
        })

        setIsRunning(running)
      } catch (error) {
        console.error('Erro ao carregar estatísticas:', error)
      }
    }

    loadStats()

    // Verificar status periodicamente
    const interval = setInterval(async () => {
      try {
        const running = await invoke<boolean>('is_instance_running', { instanceId: instance.id })
        setIsRunning(running)
      } catch (error) {
        console.error('Erro ao verificar status:', error)
      }
    }, 5000) // Verificar a cada 5 segundos

    return () => clearInterval(interval)
  }, [instance.id])
  return (
    <div className="space-y-6">
      {/* Status da Instância */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <h3 className="text-lg font-bold">
            {isRunning ? 'Rodando' : 'Parado'}
          </h3>
        </div>
        <p className="text-white/60">
          {isRunning ? 'O Minecraft está em execução' : 'Pronto para iniciar o jogo'}
        </p>
      </div>

      {/* Informações da Instância */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">Informações da Instância</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-white/40">Nome</label>
            <p className="text-white font-medium">{instance.name}</p>
          </div>
          <div>
            <label className="text-sm text-white/40">Versão do Minecraft</label>
            <p className="text-white font-medium">{instance.version || 'Desconhecida'}</p>
          </div>
          <div>
            <label className="text-sm text-white/40">Tipo</label>
            <p className="text-white font-medium">{instance.mc_type || 'Vanilla'}</p>
          </div>
          <div>
            <label className="text-sm text-white/40">Loader</label>
            <p className="text-white font-medium">
              {instance.loader_type ? `${instance.loader_type} ${instance.loader_version || ''}` : 'Nenhum'}
            </p>
          </div>
          <div>
            <label className="text-sm text-white/40">Caminho</label>
            <p className="text-white/60 font-mono text-xs break-all">{instance.path}</p>
          </div>
          <div>
            <label className="text-sm text-white/40">Último Acesso</label>
            <p className="text-white font-medium">{instance.last_played || 'Nunca'}</p>
          </div>
        </div>
      </div>

      {/* Estatísticas Rápidas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400 mb-1">{stats.mods}</div>
          <div className="text-sm text-white/60">Mods</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-400 mb-1">{stats.worlds}</div>
          <div className="text-sm text-white/60">Mundos</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-purple-400 mb-1">{stats.servers}</div>
          <div className="text-sm text-white/60">Servidores</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-orange-400 mb-1">{stats.size}</div>
          <div className="text-sm text-white/60">Tamanho</div>
        </div>
      </div>

      {/* Ações Rápidas */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">Ações Rápidas</h3>
        <div className="flex flex-wrap gap-3">
          {!isRunning ? (
            <button className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg font-medium transition-all">
              Jogar Agora
            </button>
          ) : (
            <button
              onClick={async () => {
                try {
                  await invoke('kill_instance', { instanceId: instance.id })
                  setIsRunning(false)
                } catch (error) {
                  console.error('Erro ao parar instância:', error)
                  alert('Erro ao parar a instância')
                }
              }}
              className="bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-lg font-medium transition-all"
            >
              Parar Jogo
            </button>
          )}
          <button className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg font-medium transition-all">
            Instalar Mods
          </button>
          <button className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg font-medium transition-all">
            Gerenciar Mundos
          </button>
          <button className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2 rounded-lg font-medium transition-all">
            Configurações Avançadas
          </button>
        </div>
      </div>
    </div>
  )
}

export default Overview