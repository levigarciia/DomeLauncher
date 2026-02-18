import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { GameInstance, ContextMenuTypeOrNull, Version, World, ServerData } from '../../types'

interface WorldsProps {
  instance: GameInstance
  options: ContextMenuTypeOrNull
  offline: boolean
  playing: boolean
  versions: Version[]
  installed: boolean
}

const Worlds: React.FC<WorldsProps> = ({ instance }) => {
  const [worlds, setWorlds] = useState<World[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [filters] = useState<string[]>([])
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [serverData, setServerData] = useState<Record<string, ServerData>>({})
  const [loading, setLoading] = useState(true)
  const [showAddServer, setShowAddServer] = useState(false)
  const [newServerName, setNewServerName] = useState('')
  const [newServerAddress, setNewServerAddress] = useState('')

  const carregarMundosEServidores = async () => {
    const worldsData: any[] = await invoke('get_worlds', {
      instanceId: instance.id
    })

    const serversData: any[] = await invoke('get_servers', {
      instanceId: instance.id
    })

    const allWorlds: World[] = [
      ...worldsData.map(world => ({
        type: 'singleplayer' as const,
        path: world.path,
        name: world.name,
        index: 0
      })),
      ...serversData.map((server, index) => ({
        type: 'server' as const,
        address: server.port && server.port !== 25565
          ? `${server.address}:${server.port}`
          : server.address,
        name: server.name,
        index: index + worldsData.length
      }))
    ]

    setWorlds(allWorlds)
  }

  useEffect(() => {
    const loadWorlds = async () => {
      setLoading(true)
      try {
        await carregarMundosEServidores()
      } catch (error) {
        console.error('Erro ao carregar mundos:', error)
        setWorlds([])
      } finally {
        setLoading(false)
      }
    }

    loadWorlds()
  }, [instance.id])


  const removeServer = async (address: string) => {
    try {
      await invoke('remove_server', {
        instanceId: instance.id,
        address
      })

      await carregarMundosEServidores()
    } catch (error) {
      console.error('Erro ao remover servidor:', error)
    }
  }

  const adicionarServidor = async () => {
    const nome = newServerName.trim()
    const endereco = newServerAddress.trim()

    if (!nome || !endereco) return

    try {
      await invoke('add_server', {
        instanceId: instance.id,
        name: nome,
        address: endereco
      })

      setNewServerName('')
      setNewServerAddress('')
      setShowAddServer(false)
      await carregarMundosEServidores()
    } catch (error) {
      console.error('Erro ao adicionar servidor:', error)
      alert('Não foi possível adicionar o servidor.')
    }
  }

  const deleteWorld = async (worldPath: string) => {
    if (!confirm('Tem certeza que deseja deletar este mundo? Esta ação não pode ser desfeita.')) {
      return
    }

    try {
      await invoke('delete_world', {
        instanceId: instance.id,
        worldPath
      })

      await carregarMundosEServidores()
    } catch (error) {
      console.error('Erro ao deletar mundo:', error)
    }
  }

  const pingServer = async (address: string) => {
    try {
      const result: any = await invoke('ping_server', { address })
      setServerData(prev => ({
        ...prev,
        [address]: {
          status: result.ping ? 'online' : 'offline',
          ping: result.ping,
          refreshing: false
        }
      }))
    } catch (error) {
      setServerData(prev => ({
        ...prev,
        [address]: {
          status: 'offline',
          refreshing: false
        }
      }))
    }
  }

  const filteredWorlds = worlds.filter(world => {
    const typeFilter = filters.includes('server') || filters.includes('singleplayer')
    const availableFilter = filters.includes('available')

    return (
      (!typeFilter || filters.includes(world.type)) &&
      (!availableFilter || world.type !== 'server' || serverData[world.address!]?.status) &&
      (!searchFilter || world.name.toLowerCase().includes(searchFilter.toLowerCase()))
    )
  })

  const refreshAllWorlds = async () => {
    if (refreshingAll) return

    setRefreshingAll(true)
    // Implementar lógica de refresh
    console.log('Atualizando mundos...')
    setTimeout(() => setRefreshingAll(false), 2000)
  }

  const joinWorld = (world: World) => {
    // TODO: Implementar launch do Minecraft
    console.log('Entrar no mundo:', world.name)
  }

  const editWorld = (world: World) => {
    // TODO: Implementar edição
    console.log('Editar mundo:', world.name)
  }

  const refreshServer = async (address: string) => {
    setServerData(prev => ({
      ...prev,
      [address]: {
        ...prev[address],
        refreshing: true
      }
    }))
    await pingServer(address)
  }

  const showWorldInFolder = (_instancePath: string, worldPath?: string) => {
    // TODO: Implementar abertura de pasta
    console.log('Mostrar pasta do mundo:', worldPath)
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '2px solid #10b981',
            borderTop: '2px solid transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }}></div>
          <p style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Carregando mundos...</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Modal para adicionar servidor */}
      {showAddServer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-white/10 rounded-xl p-6 w-96">
            <h3 className="text-lg font-bold mb-4 text-white">Adicionar Servidor</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Nome do Servidor</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder="Ex: Hypixel"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Endereço IP</label>
                <input
                  type="text"
                  value={newServerAddress}
                  onChange={(e) => setNewServerAddress(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder="Ex: mc.hypixel.net"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddServer(false)}
                className="flex-1 bg-white/10 text-white py-2 rounded-lg hover:bg-white/20 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={adicionarServidor}
                disabled={!newServerName.trim() || !newServerAddress.trim()}
                className="flex-1 bg-emerald-500 text-black py-2 rounded-lg hover:bg-emerald-400 transition-all disabled:opacity-50"
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {worlds.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Buscar mundos..."
                style={{
                  flexGrow: 1,
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px 0 0 4px'
                }}
              />
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter('')}
                  style={{
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderLeft: 'none',
                    borderRadius: '0 4px 4px 0',
                    cursor: 'pointer'
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={refreshAllWorlds}
              disabled={refreshingAll}
              style={{
                padding: '8px 16px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {refreshingAll ? 'Atualizando...' : 'Atualizar'}
            </button>
            <button
              onClick={() => setShowAddServer(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              + Adicionar servidor
            </button>
          </div>

          {/* Filtros seriam implementados aqui */}

          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '8px' }}>
            {filteredWorlds.map((world) => (
              <div
                key={`${world.type}-${world.type === 'singleplayer' ? world.path : `${world.address}-${world.index}`}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px',
                  backgroundColor: '#f9f9f9',
                  borderRadius: '8px',
                  border: '1px solid #e0e0e0'
                }}
              >
                <div style={{ flexGrow: 1 }}>
                  <h3 style={{ margin: '0 0 4px 0', color: '#333333' }}>
                    {world.name}
                  </h3>
                  <p style={{ margin: 0, color: '#666666', fontSize: '14px' }}>
                    {world.type === 'server' ? (
                      <span>
                        Servidor: {world.address}
                        {serverData[world.address!] && (
                          <span style={{
                            marginLeft: '8px',
                            color: serverData[world.address!].status === 'online' ? '#4caf50' : '#f44336'
                          }}>
                            ({serverData[world.address!].ping ? `${serverData[world.address!].ping}ms` : 'Offline'})
                          </span>
                        )}
                      </span>
                    ) : (
                      'Mundo singleplayer'
                    )}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => joinWorld(world)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#4caf50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Jogar
                  </button>

                  {world.type === 'server' && (
                    <button
                      onClick={() => refreshServer(world.address!)}
                      disabled={serverData[world.address!]?.refreshing}
                      style={{
                        padding: '8px 16px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Atualizar
                    </button>
                  )}

                  <button
                    onClick={() => editWorld(world)}
                    style={{
                      padding: '8px 16px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Editar
                  </button>

                  <button
                    onClick={() => world.type === 'server'
                      ? removeServer(world.address!)
                      : deleteWorld(world.path!)
                    }
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Excluir
                  </button>

                  {world.type === 'singleplayer' && world.path && (
                    <button
                      onClick={() => showWorldInFolder(instance.path, world.path)}
                      style={{
                        padding: '8px 16px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Mostrar pasta
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ width: '100%', maxWidth: '48rem', margin: '0 auto', display: 'flex', flexDirection: 'column', marginTop: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', width: '32rem', margin: '0 auto' }}>
            <img src="/sad-modrinth-bot.webp" alt="Sad Modrinth Bot" style={{ height: '96px' }} />
            <span style={{ color: '#333333', fontWeight: 'bold', fontSize: '24px' }}>
              Você ainda não tem mundos.
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'center' }}>
            <button
              onClick={() => setShowAddServer(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              + Adicionar servidor
            </button>
            <button
              onClick={refreshAllWorlds}
              disabled={refreshingAll}
              style={{
                padding: '8px 16px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {refreshingAll ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Worlds
