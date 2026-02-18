import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { GameInstance, ContextMenuTypeOrNull, Version, LogEntry } from '../../types'

interface LogsProps {
  instance: GameInstance
  options: ContextMenuTypeOrNull
  offline: boolean
  playing: boolean
  versions: Version[]
  installed: boolean
}

const Logs: React.FC<LogsProps> = ({ instance }) => {
  const [logs, setLogs] = useState<any[]>([])
  const [selectedLogIndex, setSelectedLogIndex] = useState(0)
  const [searchFilter, setSearchFilter] = useState('')
  const [levelFilters, setLevelFilters] = useState<Record<string, boolean>>({
    comment: true,
    error: true,
    warn: true,
    info: true,
    debug: true,
    trace: true
  })
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadLogs = async () => {
      setLoading(true)
      try {
        const logFiles: any[] = await invoke('get_log_files', {
          instanceId: instance.id
        })

        if (logFiles.length > 0) {
          // Carregar conteúdo do primeiro arquivo de log
          const logContent = await invoke('get_log_content', {
            instanceId: instance.id,
            filePath: logFiles[0].path
          })

          const logsData = logFiles.map((file: any, index: number) => ({
            filename: file.filename,
            path: file.path,
            stdout: index === 0 ? logContent : 'Carregando...',
            live: file.filename === 'latest.log' && false // TODO: implementar log ao vivo
          }))

          setLogs(logsData)
        } else {
          setLogs([])
        }
      } catch (error) {
        console.error('Erro ao carregar logs:', error)
        setLogs([])
      } finally {
        setLoading(false)
      }
    }

    loadLogs()
  }, [instance.id])


  const loadLogContent = async (index: number) => {
    if (logs[index] && !logs[index].stdout) {
      try {
        const content = await invoke('get_log_content', {
          instanceId: instance.id,
          filePath: logs[index].path
        })

        setLogs(prev => {
          const updated = [...prev]
          updated[index].stdout = content
          return updated
        })
      } catch (error) {
        console.error('Erro ao carregar conteúdo do log:', error)
      }
    }
  }

  const handleLogChange = async (index: number) => {
    setSelectedLogIndex(index)
    await loadLogContent(index)
  }

  const levels = ['Comment', 'Error', 'Warn', 'Info', 'Debug', 'Trace']

  const processedLogs: LogEntry[] = []
  const linhasBrutas = (logs[selectedLogIndex]?.stdout || '')
    .split('\n')
    .map((texto: string, indice: number) => ({
      id: indice,
      text: texto,
      level: 'info',
    }))

  const displayProcessedLogs: LogEntry[] = (processedLogs.length > 0 ? processedLogs : linhasBrutas).filter((log: LogEntry) => {
    if (!log.level) return true
    if (!levelFilters[log.level.toLowerCase()]) return false
    if (searchFilter && !log.text.toLowerCase().includes(searchFilter.toLowerCase())) return false
    return true
  })

  const copyLog = async () => {
    if (logs[selectedLogIndex]) {
      await navigator.clipboard.writeText(logs[selectedLogIndex].stdout || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const share = async () => {
    if (logs[selectedLogIndex]) {
      // Implementar compartilhamento de logs
      console.log('Compartilhar log:', logs[selectedLogIndex].stdout)
    }
  }

  const deleteLog = async () => {
    if (!logs[selectedLogIndex]) return
    try {
      await invoke('delete_log_file', {
        instanceId: instance.id,
        filePath: logs[selectedLogIndex].path
      })
      setLogs((anteriores) => anteriores.filter((_, indice) => indice !== selectedLogIndex))
      setSelectedLogIndex(0)
    } catch (error) {
      console.error('Erro ao excluir log:', error)
    }
  }

  const clearLiveLog = () => {
    // Implementar limpeza do log ao vivo
    console.log('Limpar log ao vivo')
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh'
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
          <p style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Carregando logs...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      height: '100vh'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <select
          value={selectedLogIndex}
          onChange={(e) => handleLogChange(Number(e.target.value))}
          disabled={logs.length === 0}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          {logs.map((log, index) => (
            <option key={index} value={index}>
              {log.filename} {log.live ? '(Ao vivo)' : ''}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={copyLog}
            disabled={!logs[selectedLogIndex]}
            style={{
              padding: '8px 16px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button
            onClick={share}
            disabled={!logs[selectedLogIndex]}
            style={{
              padding: '8px 16px',
              backgroundColor: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Compartilhar
          </button>
          {(logs[selectedLogIndex] && logs[selectedLogIndex].live === true) ? (
            <button
              onClick={clearLiveLog}
              style={{
                padding: '8px 16px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Limpar
            </button>
          ) : (
          <button
            onClick={deleteLog}
            disabled={!logs[selectedLogIndex] || logs[selectedLogIndex].live === true}
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
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder="Digite para filtrar logs..."
          style={{
            flexGrow: 1,
            padding: '12px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
        />
        <div style={{ display: 'flex', padding: '12px', flexDirection: 'row', overflow: 'auto', gap: '4px' }}>
          {levels.map(level => (
            <label key={level.toLowerCase()} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={levelFilters[level.toLowerCase()]}
                onChange={(e) => setLevelFilters({
                  ...levelFilters,
                  [level.toLowerCase()]: e.target.checked
                })}
              />
              {level}
            </label>
          ))}
        </div>
      </div>

      <div style={{
        flexGrow: 1,
        backgroundColor: '#000000',
        color: '#ffffff',
        borderRadius: '8px',
        padding: '16px',
        fontFamily: 'monospace',
        overflow: 'auto'
      }}>
        {displayProcessedLogs.length > 0 ? (
          displayProcessedLogs.map((log: LogEntry) => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
              {log.prefix && (
                <span style={{ color: log.prefixColor, fontWeight: log.weight }}>
                  {log.prefix}
                </span>
              )}
              <span style={{ color: log.textColor }}>
                {log.text}
              </span>
            </div>
          ))
        ) : (
          <div style={{ textAlign: 'center', padding: '32px' }}>
            Nenhum log encontrado ou carregando...
          </div>
        )}
      </div>
    </div>
  )
}

export default Logs
