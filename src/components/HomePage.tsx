import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  Play,
  Gamepad2,
  Globe,
  Users,
  ChevronRight,
  Loader2,
  Download,
  Star,
  MoreHorizontal,
  Wifi,
  WifiOff,
} from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import type { Instance } from "../hooks/useLauncher";
import type { MinecraftAccount } from "../App";
import { cn } from "../lib/utils";
import type { ProjetoConteudo, TipoProjetoConteudo } from "./ProjetoDetalheModal";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  icon_url: string;
  author: string;
  downloads: number;
  follows: number;
  project_type: TipoProjetoConteudo;
  slug: string;
}

interface ServerInfo {
  name: string;
  address: string;
  port: number;
  icon?: string | null;
  motd?: string | null;
  player_count?: string | null;
  playerCount?: string | null;
  ping?: number | null;
}

interface MundoInfo {
  name: string;
  path: string;
  gameMode?: string;
  difficulty?: string;
  lastPlayed?: string;
  sizeOnDisk?: string;
}

interface ServidorDome {
  id: string;
  nome: string;
  endereco: string;
  porta?: number;
  icone?: string;
  aliases?: string[];
}

const SERVIDORES_DOME: ServidorDome[] = [
  {
    id: "emergence",
    nome: "Emergence",
    endereco: "emc.domestudios.com.br",
    porta: 25565,
    icone: "/dome.png",
    aliases: ["emc.domestudios.com"],
  },
];

function validarData(data: string): Date | null {
  const dataConvertida = new Date(data);
  if (Number.isNaN(dataConvertida.getTime())) {
    return null;
  }
  return dataConvertida;
}

// Formata números grandes (ex: 1.2M, 45.3K)
function formatarNumero(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

// Tempo relativo em português
function tempoRelativo(data: string): string {
  const dataBase = validarData(data);
  if (!dataBase) return "data indisponível";

  const agora = Date.now();
  const diff = agora - dataBase.getTime();
  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "há 1 dia";
  if (dias < 7) return `há ${dias} dias`;
  const semanas = Math.floor(dias / 7);
  if (semanas === 1) return "há 1 semana";
  if (semanas < 5) return `há ${semanas} semanas`;
  return new Date(data).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function obterContagemJogadores(servidor: ServerInfo): string | undefined {
  return servidor.player_count ?? servidor.playerCount ?? undefined;
}

function normalizarEndereco(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function obterEnderecosDome(servidor: ServidorDome): string[] {
  return [servidor.endereco, ...(servidor.aliases ?? [])].map(normalizarEndereco);
}

async function pingServidorComTimeout(
  address: string,
  timeoutMs = 7000
): Promise<ServerInfo> {
  return new Promise((resolve, reject) => {
    const temporizador = window.setTimeout(() => {
      reject(new Error("Tempo esgotado ao verificar servidor"));
    }, timeoutMs);

    invoke<ServerInfo>("ping_server", { address })
      .then((resposta) => {
        window.clearTimeout(temporizador);
        resolve(resposta);
      })
      .catch((erro) => {
        window.clearTimeout(temporizador);
        reject(erro);
      });
  });
}

interface HomePageProps {
  user: MinecraftAccount | null;
  instances: Instance[];
  instanciaAtivaId: string | null;
  onSelectInstance: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onLaunchServer: (id: string, address: string) => void;
  onLogin: () => void;
  onExplore: () => void;
  onAbrirProjeto: (projeto: ProjetoConteudo) => void;
}

export default function HomePage({
  user,
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onLaunch,
  onLaunchServer,
  onLogin,
  onExplore,
  onAbrirProjeto,
}: HomePageProps) {
  const [modpacks, setModpacks] = useState<SearchResult[]>([]);
  const [mods, setMods] = useState<SearchResult[]>([]);
  const [carregando, setCarregando] = useState(true);

  // Instâncias recentes (ordenar por last_played)
  const instanciasRecentes = instances
    .filter((i) => i.last_played)
    .sort(
      (a, b) =>
        new Date(b.last_played!).getTime() -
        new Date(a.last_played!).getTime()
    )
    .slice(0, 6);

  // Buscar conteúdo em destaque
  useEffect(() => {
    const buscar = async () => {
      setCarregando(true);
      try {
        const [resModpacks, resMods] = await Promise.all([
          fetch(
            'https://api.modrinth.com/v2/search?facets=[["project_type:modpack"]]&limit=6&index=follows'
          ),
          fetch(
            'https://api.modrinth.com/v2/search?facets=[["project_type:mod"]]&limit=6&index=follows'
          ),
        ]);
        const dataModpacks = await resModpacks.json();
        const dataMods = await resMods.json();

        setModpacks(
          dataModpacks.hits.map((h: any) => ({
            id: h.project_id,
            title: h.title,
            description: h.description,
            icon_url: h.icon_url,
            author: h.author,
            downloads: h.downloads,
            follows: h.follows,
            project_type: h.project_type,
            slug: h.slug,
          }))
        );
        setMods(
          dataMods.hits.map((h: any) => ({
            id: h.project_id,
            title: h.title,
            description: h.description,
            icon_url: h.icon_url,
            author: h.author,
            downloads: h.downloads,
            follows: h.follows,
            project_type: h.project_type,
            slug: h.slug,
          }))
        );
      } catch (e) {
        console.error("Erro ao buscar conteúdo:", e);
      } finally {
        setCarregando(false);
      }
    };
    buscar();
  }, []);

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3"
      >
        <h1 className="text-3xl font-black tracking-tight">
          {user ? `Bem vindo de volta, ${user.name}!` : "Bem vindo ao Dome Launcher!"}
        </h1>

        {instanciaAtivaId && (
          <span className="inline-flex items-center gap-2 px-1 text-xs font-bold text-emerald-300">
            <Activity size={12} />
            Instância em execução
          </span>
        )}
      </motion.div>

      {instanciasRecentes.length > 0 && (
        <SecaoVolteAJogar
          instances={instanciasRecentes}
          instanciaAtivaId={instanciaAtivaId}
          onSelectInstance={onSelectInstance}
          onLaunch={onLaunch}
          onLaunchServer={onLaunchServer}
          onLogin={onLogin}
          user={user}
        />
      )}

      <SecaoServidoresDome
        instances={instances}
        instanciaAtivaId={instanciaAtivaId}
        user={user}
        onLaunchServer={onLaunchServer}
        onLogin={onLogin}
      />

      <SecaoDestaque
        titulo="Descubra modpacks"
        itens={modpacks}
        carregando={carregando}
        delay={0.1}
        onVerMais={onExplore}
        onAbrirProjeto={(item) => onAbrirProjeto({ ...item, source: "modrinth" })}
      />

      <SecaoDestaque
        titulo="Descubra mods"
        itens={mods}
        carregando={carregando}
        delay={0.15}
        onVerMais={onExplore}
        onAbrirProjeto={(item) => onAbrirProjeto({ ...item, source: "modrinth" })}
      />
    </div>
  );
}

function SecaoServidoresDome({
  instances,
  instanciaAtivaId,
  user,
  onLaunchServer,
  onLogin,
}: {
  instances: Instance[];
  instanciaAtivaId: string | null;
  user: MinecraftAccount | null;
  onLaunchServer: (id: string, address: string) => void;
  onLogin: () => void;
}) {
  const [idsServidoresOcultos, setIdsServidoresOcultos] = useState<string[]>([]);
  const [statusServidores, setStatusServidores] = useState<
    Record<
      string,
      {
        online: boolean;
        ping?: number;
        jogadores?: string;
        motd?: string;
        icon?: string | null;
        erro?: string;
      }
    >
  >({});

  const instanciaSelecionada =
    instances.find((instancia) => instancia.id === instanciaAtivaId) ?? instances[0] ?? null;

  const servidoresDomeVisiveis = useMemo(() => {
    const ocultos = new Set(idsServidoresOcultos);
    return SERVIDORES_DOME.filter((servidor) => !ocultos.has(servidor.id));
  }, [idsServidoresOcultos]);

  useEffect(() => {
    let cancelado = false;

    const mapearServidoresJaSalvos = async () => {
      const idsEncontrados = new Set<string>();

      await Promise.all(
        instances.map(async (instancia) => {
          try {
            const servidores = await invoke<ServerInfo[]>("get_servers", {
              instanceId: instancia.id,
            });

            for (const servidorSalvo of servidores) {
              const enderecoSalvo = normalizarEndereco(servidorSalvo.address);
              for (const servidorDome of SERVIDORES_DOME) {
                if (obterEnderecosDome(servidorDome).includes(enderecoSalvo)) {
                  idsEncontrados.add(servidorDome.id);
                }
              }
            }
          } catch {
            // Ignorar instâncias com erro de leitura dos servidores.
          }
        })
      );

      if (!cancelado) {
        setIdsServidoresOcultos(Array.from(idsEncontrados));
      }
    };

    if (instances.length > 0) {
      mapearServidoresJaSalvos();
      return () => {
        cancelado = true;
      };
    }

    setIdsServidoresOcultos([]);
    return () => {
      cancelado = true;
    };
  }, [instances]);

  useEffect(() => {
    let cancelado = false;

    const verificarStatus = async () => {
      await Promise.all(
        servidoresDomeVisiveis.map(async (servidor) => {
          const destino =
            servidor.porta && servidor.porta !== 25565
              ? `${servidor.endereco}:${servidor.porta}`
              : servidor.endereco;

          try {
            const resposta = await pingServidorComTimeout(destino);
            if (cancelado) return;

            setStatusServidores((anterior) => ({
              ...anterior,
              [servidor.id]: {
                online: true,
                ping: resposta.ping ?? undefined,
                jogadores: obterContagemJogadores(resposta),
                motd: resposta.motd ?? undefined,
                icon: resposta.icon ?? servidor.icone ?? null,
              },
            }));
          } catch {
            if (cancelado) return;

            setStatusServidores((anterior) => ({
              ...anterior,
              [servidor.id]: {
                online: false,
                icon: servidor.icone ?? null,
                erro: "Offline",
              },
            }));
          }
        })
      );
    };

    if (servidoresDomeVisiveis.length === 0) {
      return () => {
        cancelado = true;
      };
    }

    verificarStatus();
    const intervaloAtualizacao = window.setInterval(verificarStatus, 30_000);

    return () => {
      cancelado = true;
      window.clearInterval(intervaloAtualizacao);
    };
  }, [servidoresDomeVisiveis]);

  if (servidoresDomeVisiveis.length === 0) {
    return null;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider">
          Conheça a Dome Studios
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {servidoresDomeVisiveis.map((servidor, i) => {
          const status = statusServidores[servidor.id];
          const destino =
            servidor.porta && servidor.porta !== 25565
              ? `${servidor.endereco}:${servidor.porta}`
              : servidor.endereco;

          const statusTexto = !status
            ? "Verificando"
            : status.online
            ? "Online"
            : "Offline";
          const statusClasses = !status
            ? "text-white/60 bg-white/10"
            : status.online
            ? "text-emerald-300 bg-emerald-500/15"
            : "text-red-300 bg-red-500/15";

          return (
            <motion.div
              key={servidor.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.04 }}
              className="group relative flex items-center gap-3 rounded-2xl border border-white/8 bg-white/3 px-3 py-3 transition-all hover:bg-white/5 hover:border-white/15"
            >
              <div className="w-12 h-12 rounded-lg bg-[#151516] border border-white/10 p-1 overflow-hidden shrink-0">
                <img
                  src={status?.icon || servidor.icone || "/dome.svg"}
                  alt={servidor.nome}
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm truncate">{servidor.nome}</h3>
                  <span
                    className={cn(
                      "flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded",
                      statusClasses
                    )}
                  >
                    {!status ? (
                      <Loader2 size={9} className="animate-spin" />
                    ) : status.online ? (
                      <Wifi size={9} />
                    ) : (
                      <WifiOff size={9} />
                    )}
                    {statusTexto}
                  </span>
                </div>

                <p className="text-[11px] text-white/35 truncate mt-0.5">{destino}</p>

                <div className="flex items-center gap-3 text-[10px] text-white/30 mt-1">
                  <span className="flex items-center gap-1">
                    <Users size={9} />
                    {status?.jogadores || "--/--"}
                  </span>
                  <span>{status?.ping != null ? `${status.ping}ms` : "-- ms"}</span>
                  {instanciaSelecionada ? (
                    <span className="truncate">Instância: {instanciaSelecionada.name}</span>
                  ) : (
                    <span className="text-amber-300/80">Crie uma instância para jogar</span>
                  )}
                </div>

                {status?.motd && (
                  <p className="text-[10px] text-white/35 mt-1 truncate">
                    {status.motd}
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  if (!user) {
                    onLogin();
                    return;
                  }
                  if (!instanciaSelecionada) return;
                  onLaunchServer(instanciaSelecionada.id, destino);
                }}
                disabled={Boolean(user) && !instanciaSelecionada}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                  !user || instanciaSelecionada
                    ? "bg-white/5 hover:bg-emerald-500/20 border-white/5 hover:border-emerald-500/30 text-white/50 hover:text-emerald-400"
                    : "bg-white/5 border-white/8 text-white/25 cursor-not-allowed"
                )}
              >
                <Play size={12} fill="currentColor" />
                {!user ? "Login" : instanciaSelecionada ? "Jogar" : "Sem instância"}
              </button>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

// ===== SEÇÃO "VOLTE A JOGAR" (estilo Modrinth "Jump back in") =====
function SecaoVolteAJogar({
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onLaunch,
  onLaunchServer,
  onLogin,
  user,
}: {
  instances: Instance[];
  instanciaAtivaId: string | null;
  onSelectInstance: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onLaunchServer: (id: string, address: string) => void;
  onLogin: () => void;
  user: MinecraftAccount | null;
}) {
  type ItemVolteAJogar =
    | { tipo: "instancia"; instancia: Instance }
    | { tipo: "mundo"; instancia: Instance; mundo: MundoInfo }
    | { tipo: "servidor"; instancia: Instance; servidor: ServerInfo };

  const [itensVolteAJogar, setItensVolteAJogar] = useState<ItemVolteAJogar[]>(
    []
  );
  const [serverStatus, setServerStatus] = useState<
    Record<string, { online: boolean; error?: string; ping?: number; icon?: string | null }>
  >({});

  const chaveServidor = (instanciaId: string, servidor: ServerInfo) =>
    `${instanciaId}:${servidor.address}:${servidor.port}`;

  useEffect(() => {
    let cancelado = false;

    const carregarItens = async () => {
      const gruposPorInstancia = await Promise.all(
        instances.map(async (instancia) => {
          let servidores: ServerInfo[] = [];
          let mundos: MundoInfo[] = [];

          try {
            servidores = await invoke<ServerInfo[]>("get_servers", {
              instanceId: instancia.id,
            });
          } catch {
            // Ignorar erros de leitura de servidores nesta seção.
          }

          try {
            mundos = await invoke<MundoInfo[]>("get_worlds", {
              instanceId: instancia.id,
            });
          } catch {
            // Ignorar erros de leitura de mundos nesta seção.
          }

          const itensDaInstancia: ItemVolteAJogar[] = [];

          if (servidores.length > 0) {
            itensDaInstancia.push({
              tipo: "servidor",
              instancia,
              servidor: servidores[0],
            });
          }

          if (mundos.length > 0) {
            itensDaInstancia.push({
              tipo: "mundo",
              instancia,
              mundo: mundos[0],
            });
          }

          if (itensDaInstancia.length === 0) {
            itensDaInstancia.push({ tipo: "instancia", instancia });
          }

          return itensDaInstancia;
        })
      );

      const itens = gruposPorInstancia.flat();
      const itensPrioritarios = itens.filter((item) => item.tipo !== "instancia");
      const itensFallback = itens.filter((item) => item.tipo === "instancia");
      const itensOrdenados = [...itensPrioritarios, ...itensFallback];

      if (!cancelado) {
        setItensVolteAJogar(itensOrdenados.slice(0, 6));
      }
    };

    carregarItens();

    return () => {
      cancelado = true;
    };
  }, [instances]);

  useEffect(() => {
    let cancelado = false;

    const verificarServidores = async () => {
      const itensServidor = itensVolteAJogar.filter(
        (item): item is Extract<ItemVolteAJogar, { tipo: "servidor" }> =>
          item.tipo === "servidor"
      );

      await Promise.all(
        itensServidor.map(async (item) => {
          const chave = chaveServidor(item.instancia.id, item.servidor);
          const destino =
            item.servidor.port && item.servidor.port !== 25565
              ? `${item.servidor.address}:${item.servidor.port}`
              : item.servidor.address;

          try {
            const ping = await pingServidorComTimeout(destino);
            if (cancelado) return;

            setServerStatus((prev) => ({
              ...prev,
              [chave]: {
                online: true,
                ping: ping.ping ?? undefined,
                icon: ping.icon ?? item.servidor.icon ?? undefined,
              },
            }));
          } catch {
            if (cancelado) return;

            setServerStatus((prev) => ({
              ...prev,
                [chave]: {
                  online: false,
                  error: "Não foi possível se conectar ao servidor",
                  icon: item.servidor.icon ?? undefined,
                },
              }));
          }
        })
      );
    };

    if (itensVolteAJogar.length > 0) {
      verificarServidores();
    }

    return () => {
      cancelado = true;
    };
  }, [itensVolteAJogar]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider">
          Volte a jogar
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {itensVolteAJogar.map((item, i) => {
          const instance = item.instancia;
          const instanciaAberta = instance.id === instanciaAtivaId;
          const status =
            item.tipo === "servidor"
              ? serverStatus[chaveServidor(instance.id, item.servidor)]
              : undefined;

          return (
            <motion.div
              key={
                item.tipo === "instancia"
                  ? `instancia-${instance.id}`
                  : item.tipo === "mundo"
                  ? `mundo-${instance.id}-${item.mundo.path}`
                  : `servidor-${instance.id}-${item.servidor.address}-${item.servidor.port}`
              }
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.04 }}
              onClick={() => onSelectInstance(instance)}
              className={cn(
                "group relative flex items-center gap-3 rounded-2xl border px-3 py-2.5 cursor-pointer transition-all",
                instanciaAberta
                  ? "bg-emerald-500/10 border-emerald-400/25 shadow-[0_0_28px_rgba(16,185,129,0.2)]"
                  : "bg-white/3 hover:bg-white/5 border-white/8 hover:border-white/15"
              )}
            >
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-lg bg-[#151516] border border-white/10 p-1 overflow-hidden">
                  <img
                    src={
                      item.tipo === "servidor"
                        ? status?.icon || item.servidor.icon || instance.icon || "/dome.svg"
                        : item.tipo === "mundo"
                        ? instance.icon || "/dome.svg"
                        : instance.icon || "/dome.svg"
                    }
                    alt={
                      item.tipo === "servidor"
                        ? item.servidor.name
                        : item.tipo === "mundo"
                        ? item.mundo.name
                        : instance.name
                    }
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm truncate">
                    {item.tipo === "instancia"
                      ? instance.name
                      : item.tipo === "mundo"
                      ? item.mundo.name
                      : item.servidor.name}
                  </h3>

                  {instanciaAberta && (
                    <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded text-emerald-300 bg-emerald-500/15">
                      <Activity size={9} />
                      Aberta
                    </span>
                  )}

                  {item.tipo === "servidor" && (
                    (() => {
                      const estado = !status
                        ? "verificando"
                        : status.online
                        ? "online"
                        : "offline";
                      const classes =
                        estado === "online"
                          ? "text-emerald-400 bg-emerald-500/10"
                          : estado === "offline"
                          ? "text-red-400 bg-red-500/10"
                          : "text-white/60 bg-white/10";

                      return (
                        <span
                          className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${classes}`}
                        >
                          {estado === "online" ? (
                            <Wifi size={9} />
                          ) : estado === "offline" ? (
                            <WifiOff size={9} />
                          ) : (
                            <Loader2 size={9} className="animate-spin" />
                          )}
                          {estado === "online"
                            ? "Online"
                            : estado === "offline"
                            ? "Offline"
                            : "Verificando"}
                        </span>
                      );
                    })()
                  )}

                  {item.tipo === "mundo" && (
                    <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded text-blue-300 bg-blue-500/15">
                      <Globe size={9} />
                      Mundo
                    </span>
                  )}
                </div>

                {item.tipo === "instancia" ? (
                  <div className="flex items-center gap-2 mt-0.5">
                    {instance.last_played && (
                      <span className="text-[11px] text-white/30">
                        Jogou {tempoRelativo(instance.last_played)}
                      </span>
                    )}

                    <span className="text-white/10">•</span>

                    <span className="flex items-center gap-1 text-[11px] text-white/30">
                      <Gamepad2 size={10} />
                      {instance.loader_type || instance.mc_type} {instance.version}
                    </span>
                  </div>
                ) : item.tipo === "mundo" ? (
                  <div className="mt-0.5">
                    <span className="text-[11px] text-white/30">Mundo local</span>
                    <div className="text-[10px] text-white/25 mt-0.5">
                      Na instância {instance.name}
                      {instance.last_played ? ` • ${tempoRelativo(instance.last_played)}` : ""}
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5">
                    <span className="text-[11px] text-white/30">
                      {item.servidor.address}
                      {item.servidor.port && item.servidor.port !== 25565
                        ? `:${item.servidor.port}`
                        : ""}
                    </span>
                    <div className="text-[10px] text-white/25 mt-0.5">
                      Na instância {instance.name}
                      {status?.ping != null ? ` • ${status.ping}ms` : ""}
                    </div>
                  </div>
                )}

                {item.tipo === "servidor" && !status?.online && status?.error && (
                  <p className="text-[10px] text-red-400/50 mt-0.5 italic truncate">
                    {status.error}
                  </p>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!user) {
                    onLogin();
                    return;
                  }
                  if (item.tipo === "instancia" || item.tipo === "mundo") {
                    onLaunch(instance.id);
                  } else {
                    const destino =
                      item.servidor.port && item.servidor.port !== 25565
                        ? `${item.servidor.address}:${item.servidor.port}`
                        : item.servidor.address;
                    onLaunchServer(instance.id, destino);
                  }
                }}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-emerald-500/20 border border-white/5 hover:border-emerald-500/30 text-white/50 hover:text-emerald-400 transition-all text-xs font-bold"
              >
                <Play size={12} fill="currentColor" />
                {item.tipo === "instancia"
                  ? instanciaAberta
                    ? "Focar"
                    : "Play"
                  : item.tipo === "mundo"
                  ? "Jogar"
                  : "Abrir"}
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectInstance(instance);
                }}
                className="shrink-0 p-1.5 rounded-lg text-white/20 hover:text-white/40 hover:bg-white/5 transition-all"
              >
                <MoreHorizontal size={14} />
              </button>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

// ===== SEÇÃO DE DESTAQUE (modpacks ou mods) =====
function SecaoDestaque({
  titulo,
  itens,
  carregando,
  delay,
  onVerMais,
  onAbrirProjeto,
}: {
  titulo: string;
  itens: SearchResult[];
  carregando: boolean;
  delay: number;
  onVerMais: () => void;
  onAbrirProjeto: (item: SearchResult) => void;
}) {
  if (carregando) {
    return (
      <div className="flex items-center gap-2 py-6 text-white/20">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Carregando {titulo.toLowerCase()}...</span>
      </div>
    );
  }

  if (itens.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider">
          {titulo}
        </h2>
        <button
          onClick={onVerMais}
          className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          Ver mais
          <ChevronRight size={12} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {itens.slice(0, 3).map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay + i * 0.04 }}
            onClick={() => onAbrirProjeto(item)}
            className="bg-white/3 border border-white/5 hover:border-white/10 rounded-xl p-3 cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-3">
              <img
                src={
                  item.icon_url ||
                  `https://api.dicebear.com/9.x/shapes/svg?seed=${item.id}`
                }
                alt={item.title}
                className="w-10 h-10 rounded-lg bg-black/40 object-cover shrink-0"
              />
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm truncate group-hover:text-emerald-400 transition-colors">
                  {item.title}
                </h3>
                <div className="flex items-center gap-1.5 text-white/40 text-xs mt-0.5">
                  <Gamepad2 size={10} />
                  <span className="truncate">
                    {item.author}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
              <div className="flex gap-3 text-white/30 text-[10px]">
                <span className="flex items-center gap-1">
                  <Download size={9} />
                  {formatarNumero(item.downloads)}
                </span>
                <span className="flex items-center gap-1">
                  <Star size={9} />
                  {formatarNumero(item.follows)}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
