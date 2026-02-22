import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Avatar,
  ChevronLeft,
  ChevronRight,
  Heart,
  Home,
  Library,
  Loader2,
  LogIn,
  Play,
  Plus,
  Search,
  Settings,
  User,
} from "./iconesPixelados";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { cn } from "./lib/utils";
import Explore from "./components/Explore";
import Favorites from "./components/Favorites";
import LibraryPage from "./components/LibraryPage";
import HomePage from "./components/HomePage";
import { LoginModal } from "./components/LoginModal";
import CreateInstanceModal from "./components/CreateInstanceModal";
import CreatingInstancesOverlay from "./components/CreatingInstancesOverlay";
import SettingsPage from "./components/Settings";
import { useLauncher, type Instance } from "./hooks/useLauncher";
import { SkinManager } from "./components/SkinManager";
import InstanceManager from "./components/InstanceManager";
import ProjetoDetalheModal, {
  type AbaOrigemProjeto,
  type ProjetoConteudo,
} from "./components/ProjetoDetalheModal";
import SocialSidebar from "./components/SocialSidebar";

export interface MinecraftAccount {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

const CHAVE_ULTIMA_INSTANCIA = "dome:ultima-instancia-iniciada";
const INTERVALO_VERIFICACAO_INSTANCIAS_MS = 20 * 1000;
type TipoExplorePresence = "modpack" | "mod" | "resourcepack" | "shader";
type FonteExplorePresence = "modrinth" | "curseforge";
type CorDestaque = "verde" | "azul" | "laranja" | "rosa" | "ciano";

function normalizarCorDestaque(valor: unknown): CorDestaque {
  const texto = String(valor || "").toLowerCase().trim();
  if (texto === "azul" || texto === "laranja" || texto === "rosa" || texto === "ciano") {
    return texto;
  }
  return "verde";
}

const TITULOS_ABA: Record<string, string> = {
  home: "Início",
  instances: "Biblioteca",
  explore: "Explorar",
  favorites: "Favoritos",
  skins: "Skins",
  settings: "Configurações",
  "instance-manager": "Instância",
  "project-detail": "Projeto",
};

export default function App() {
  const { instances, launch, launchServer, remove } = useLauncher();
  const [activeTab, setActiveTab] = useState("home");
  const [barraLateralExpandida, setBarraLateralExpandida] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [managedInstanceId, setManagedInstanceId] = useState<string>("");
  const [user, setUser] = useState<MinecraftAccount | null>(null);
  const [mapaExecucao, setMapaExecucao] = useState<Record<string, boolean>>({});
  const [servidorPorInstancia, setServidorPorInstancia] = useState<Record<string, string>>({});
  const [contextoExplore, setContextoExplore] = useState<{
    tipo: TipoExplorePresence;
    fonte: FonteExplorePresence;
    titulo?: string;
  } | null>(null);
  const [ultimaInstanciaIniciada, setUltimaInstanciaIniciada] = useState<string | null>(() =>
    localStorage.getItem(CHAVE_ULTIMA_INSTANCIA)
  );
  const [atualizacaoDisponivel, setAtualizacaoDisponivel] = useState<Update | null>(null);
  const [instalandoAtualizacao, setInstalandoAtualizacao] = useState(false);
  const [erroAtualizacao, setErroAtualizacao] = useState<string | null>(null);
  const [progressoAtualizacao, setProgressoAtualizacao] = useState<{
    baixados: number;
    total?: number;
  } | null>(null);
  const [projetoDetalhe, setProjetoDetalhe] = useState<ProjetoConteudo | null>(null);
  const [abaOrigemProjeto, setAbaOrigemProjeto] = useState<AbaOrigemProjeto>("home");
  const [corDestaque, setCorDestaque] = useState<CorDestaque>("verde");
  const [contasMinecraft, setContasMinecraft] = useState<MinecraftAccount[]>([]);
  const [carregandoContasMinecraft, setCarregandoContasMinecraft] = useState(false);
  const [menuContaAberto, setMenuContaAberto] = useState(false);
  const ultimaAssinaturaPresence = useRef<string>("");
  const menuContaRef = useRef<HTMLDivElement | null>(null);

  const carregarContasMinecraft = useCallback(async () => {
    setCarregandoContasMinecraft(true);
    try {
      const contas = await invoke<MinecraftAccount[]>("list_minecraft_accounts");
      setContasMinecraft(contas ?? []);
    } catch (erro) {
      console.error("Falha ao carregar contas salvas", erro);
      setContasMinecraft([]);
    } finally {
      setCarregandoContasMinecraft(false);
    }
  }, []);

  const carregarContaMinecraftAtiva = useCallback(async () => {
    try {
      const account = await invoke<MinecraftAccount | null>("check_auth_status");
      if (!account) {
        setUser(null);
        return;
      }

      const agora = Math.floor(Date.now() / 1000);
      const expiracao = account.expires_at;
      if (expiracao && agora >= expiracao) {
        try {
          const refreshed = await invoke<MinecraftAccount>("refresh_token");
          setUser(refreshed);
          return;
        } catch {
          setUser(account);
          return;
        }
      }

      setUser(account);
    } catch (e) {
      console.error("Falha ao verificar auth", e);
      setUser(null);
    }
  }, []);

  const atualizarSessaoMinecraft = useCallback(async () => {
    await Promise.all([carregarContaMinecraftAtiva(), carregarContasMinecraft()]);
  }, [carregarContaMinecraftAtiva, carregarContasMinecraft]);

  const deslogarContaMinecraft = useCallback(async () => {
    try {
      await invoke("logout");
    } catch (erro) {
      console.error("Falha ao deslogar conta", erro);
    } finally {
      setUser(null);
      await carregarContasMinecraft();
    }
  }, [carregarContasMinecraft]);

  const trocarContaMinecraft = useCallback(
    async (uuid: string) => {
      try {
        const conta = await invoke<MinecraftAccount>("switch_minecraft_account", { uuid });
        setUser(conta);
      } catch (erro) {
        console.error("Falha ao trocar conta", erro);
      } finally {
        await carregarContasMinecraft();
      }
    },
    [carregarContasMinecraft]
  );

  const removerContaMinecraft = useCallback(
    async (uuid: string) => {
      try {
        await invoke("remove_minecraft_account", { uuid });
        if (user?.uuid === uuid) {
          setUser(null);
        }
      } catch (erro) {
        console.error("Falha ao remover conta", erro);
      } finally {
        await atualizarSessaoMinecraft();
      }
    },
    [atualizarSessaoMinecraft, user?.uuid]
  );

  useEffect(() => {
    atualizarSessaoMinecraft();
  }, [atualizarSessaoMinecraft]);

  useEffect(() => {
    const carregarCorDestaque = async () => {
      try {
        const configuracoes = await invoke<{ cor_destaque?: string }>("get_settings");
        setCorDestaque(normalizarCorDestaque(configuracoes?.cor_destaque));
      } catch {
        setCorDestaque("verde");
      }
    };

    const aoAtualizarCor = (evento: Event) => {
      const detalhe = (evento as CustomEvent<{ cor?: string }>).detail;
      setCorDestaque(normalizarCorDestaque(detalhe?.cor));
    };

    carregarCorDestaque();
    window.addEventListener("dome:cor-destaque-atualizada", aoAtualizarCor);
    return () => {
      window.removeEventListener("dome:cor-destaque-atualizada", aoAtualizarCor);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-cor-destaque", corDestaque);
  }, [corDestaque]);

  useEffect(() => {
    if (!menuContaAberto) {
      return;
    }

    const fecharAoClicarFora = (evento: MouseEvent) => {
      if (
        menuContaRef.current &&
        !menuContaRef.current.contains(evento.target as Node)
      ) {
        setMenuContaAberto(false);
      }
    };

    const fecharAoPressionarEscape = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        setMenuContaAberto(false);
      }
    };

    document.addEventListener("mousedown", fecharAoClicarFora);
    window.addEventListener("keydown", fecharAoPressionarEscape);

    return () => {
      document.removeEventListener("mousedown", fecharAoClicarFora);
      window.removeEventListener("keydown", fecharAoPressionarEscape);
    };
  }, [menuContaAberto]);

  useEffect(() => {
    if (instances.length > 0 && !selectedInstance) {
      setSelectedInstance(instances[0]);
    }
  }, [instances, selectedInstance]);

  useEffect(() => {
    setMenuContaAberto(false);
  }, [activeTab]);

  useEffect(() => {
    if (ultimaInstanciaIniciada) {
      localStorage.setItem(CHAVE_ULTIMA_INSTANCIA, ultimaInstanciaIniciada);
    } else {
      localStorage.removeItem(CHAVE_ULTIMA_INSTANCIA);
    }
  }, [ultimaInstanciaIniciada]);

  const verificarAtualizacoes = useCallback(async () => {
    if (import.meta.env.DEV) {
      return;
    }

    try {
      const atualizacao = await check();
      if (atualizacao) {
        setAtualizacaoDisponivel(atualizacao);
      }
    } catch (erro) {
      console.warn("Falha ao verificar atualização do launcher:", erro);
    }
  }, []);

  const instalarAtualizacao = useCallback(async () => {
    if (!atualizacaoDisponivel || instalandoAtualizacao) {
      return;
    }

    setErroAtualizacao(null);
    setInstalandoAtualizacao(true);
    setProgressoAtualizacao(null);

    try {
      await atualizacaoDisponivel.downloadAndInstall((evento) => {
        if (evento.event === "Started") {
          setProgressoAtualizacao({
            baixados: 0,
            total: evento.data.contentLength,
          });
          return;
        }

        if (evento.event === "Progress") {
          setProgressoAtualizacao((anterior) => ({
            baixados: (anterior?.baixados ?? 0) + evento.data.chunkLength,
            total: anterior?.total,
          }));
        }
      });

      await invoke("reiniciar_aplicativo");
    } catch (erro) {
      setErroAtualizacao(
        erro instanceof Error
          ? erro.message
          : "Não foi possível instalar a atualização agora."
      );
    } finally {
      setInstalandoAtualizacao(false);
    }
  }, [atualizacaoDisponivel, instalandoAtualizacao]);

  useEffect(() => {
    verificarAtualizacoes();
    const intervalo = window.setInterval(verificarAtualizacoes, 15 * 60 * 1000);
    return () => window.clearInterval(intervalo);
  }, [verificarAtualizacoes]);

  const verificarInstanciasEmExecucao = useCallback(async () => {
    if (instances.length === 0) {
      setMapaExecucao({});
      return;
    }

    const idsInstancias = instances.map((instancia) => instancia.id);

    try {
      const mapa = await invoke<Record<string, boolean>>("get_running_instances", {
        instanceIds: idsInstancias,
      });
      const mapaNormalizado = Object.fromEntries(
        idsInstancias.map((id) => [id, Boolean(mapa?.[id])])
      );
      setMapaExecucao(mapaNormalizado);
    } catch (erro) {
      console.warn("Falha ao verificar instâncias em execução", erro);
      setMapaExecucao((anterior) =>
        Object.fromEntries(idsInstancias.map((id) => [id, Boolean(anterior[id])]))
      );
    }
  }, [instances]);

  const atualizarPresenceDiscord = useCallback(
    async (payload: {
      detalhes: string;
      estado?: string;
    }) => {
      const assinatura = JSON.stringify(payload);
      if (assinatura === ultimaAssinaturaPresence.current) {
        return;
      }

      try {
        await invoke("atualizar_discord_presence", { payload });
        ultimaAssinaturaPresence.current = assinatura;
      } catch (erro) {
        console.warn("Falha ao atualizar Discord Rich Presence:", erro);
      }
    },
    []
  );

  useEffect(() => {
    verificarInstanciasEmExecucao();
    const intervalo = window.setInterval(
      verificarInstanciasEmExecucao,
      INTERVALO_VERIFICACAO_INSTANCIAS_MS
    );
    const aoVoltarParaJanela = () => {
      verificarInstanciasEmExecucao();
    };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "visible") {
        verificarInstanciasEmExecucao();
      }
    };

    window.addEventListener("focus", aoVoltarParaJanela);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", aoVoltarParaJanela);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [verificarInstanciasEmExecucao]);

  const instanciaAtiva = useMemo(() => {
    if (instances.length === 0) return null;

    if (
      ultimaInstanciaIniciada &&
      mapaExecucao[ultimaInstanciaIniciada] &&
      instances.some((instancia) => instancia.id === ultimaInstanciaIniciada)
    ) {
      return instances.find((instancia) => instancia.id === ultimaInstanciaIniciada) ?? null;
    }

    if (selectedInstance && mapaExecucao[selectedInstance.id]) {
      return selectedInstance;
    }

    return instances.find((instancia) => mapaExecucao[instancia.id]) ?? null;
  }, [instances, mapaExecucao, selectedInstance, ultimaInstanciaIniciada]);

  const instanciaGerenciada = useMemo(
    () => instances.find((instancia) => instancia.id === managedInstanceId) ?? null,
    [instances, managedInstanceId]
  );
  const contasAlternativas = useMemo(() => {
    if (!user) {
      return contasMinecraft;
    }
    return contasMinecraft.filter((conta) => conta.uuid !== user.uuid);
  }, [contasMinecraft, user]);

  const textoProgressoAtualizacao = useMemo(() => {
    if (!progressoAtualizacao) {
      return null;
    }

    const baixarEmMb = (valor: number) => (valor / 1024 / 1024).toFixed(1);
    if (progressoAtualizacao.total && progressoAtualizacao.total > 0) {
      const percentual = Math.min(
        100,
        Math.round((progressoAtualizacao.baixados / progressoAtualizacao.total) * 100)
      );
      return `${percentual}% (${baixarEmMb(progressoAtualizacao.baixados)}MB de ${baixarEmMb(progressoAtualizacao.total)}MB)`;
    }

    return `${baixarEmMb(progressoAtualizacao.baixados)}MB baixados`;
  }, [progressoAtualizacao]);

  const montarPresenceLauncher = useCallback(() => {
    if (activeTab === "settings") {
      return { detalhes: "Nas Configurações", estado: "Ajustando o launcher" };
    }

    if (activeTab === "explore") {
      if (contextoExplore?.titulo) {
        const prefixoTipo =
          contextoExplore.tipo === "modpack"
            ? "modpack"
            : contextoExplore.tipo === "mod"
              ? "mod"
              : contextoExplore.tipo === "resourcepack"
                ? "resource pack"
                : "shader";
        return {
          detalhes: `Vendo ${prefixoTipo} ${contextoExplore.titulo}`,
          estado: `Fonte: ${contextoExplore.fonte === "curseforge" ? "CurseForge" : "Modrinth"}`,
        };
      }
      return { detalhes: "Explorando conteúdo", estado: "Mods, modpacks e shaders" };
    }

    if (activeTab === "project-detail") {
      if (projetoDetalhe) {
        return {
          detalhes: `Vendo ${projetoDetalhe.title}`,
          estado: `Projeto ${projetoDetalhe.project_type}`,
        };
      }
      return { detalhes: "Vendo projeto", estado: "Analisando detalhes" };
    }

    if (activeTab === "instance-manager") {
      if (instanciaGerenciada) {
        return {
          detalhes: `Gerenciando ${instanciaGerenciada.name}`,
          estado: `${instanciaGerenciada.loader_type || instanciaGerenciada.mc_type} ${instanciaGerenciada.version}`,
        };
      }
      return { detalhes: "Gerenciando instância", estado: "Ajustando arquivos e conteúdo" };
    }

    if (activeTab === "instances") {
      return { detalhes: "Na Biblioteca", estado: `${instances.length} instância(s)` };
    }

    if (activeTab === "favorites") {
      return { detalhes: "Nos Favoritos", estado: "Organizando biblioteca" };
    }

    if (activeTab === "skins") {
      return { detalhes: "No Gerenciador de Skins", estado: "Visualizando..." };
    }

    return { detalhes: "Na tela inicial", estado: "Escolhendo o que jogar" };
  }, [activeTab, contextoExplore, instanciaGerenciada, instances.length, projetoDetalhe]);

  const iniciarInstancia = useCallback(
    async (id: string) => {
      setUltimaInstanciaIniciada(id);
      setServidorPorInstancia((anterior) => {
        const proximo = { ...anterior };
        delete proximo[id];
        return proximo;
      });
      await launch(id);
      const instancia = instances.find((item) => item.id === id);
      await atualizarPresenceDiscord({
        detalhes: instancia ? `Jogando ${instancia.name}` : "Jogando Minecraft",
        estado: instancia
          ? `${instancia.loader_type || instancia.mc_type} ${instancia.version}`
          : "Iniciando sessão",
      });
      setTimeout(() => {
        verificarInstanciasEmExecucao();
      }, 1300);
    },
    [launch, instances, atualizarPresenceDiscord, verificarInstanciasEmExecucao]
  );

  const iniciarInstanciaServidor = useCallback(
    async (id: string, address: string) => {
      setUltimaInstanciaIniciada(id);
      setServidorPorInstancia((anterior) => ({ ...anterior, [id]: address }));
      await launchServer(id, address);
      const instancia = instances.find((item) => item.id === id);
      await atualizarPresenceDiscord({
        detalhes: `Jogando no servidor ${address}`,
        estado: instancia
          ? `${instancia.loader_type || instancia.mc_type} ${instancia.version}`
          : "Conectando ao servidor",
      });
      setTimeout(() => {
        verificarInstanciasEmExecucao();
      }, 1300);
    },
    [launchServer, instances, atualizarPresenceDiscord, verificarInstanciasEmExecucao]
  );

  useEffect(() => {
    if (instanciaAtiva) {
      const enderecoServidor = servidorPorInstancia[instanciaAtiva.id];
      atualizarPresenceDiscord({
        detalhes: enderecoServidor
          ? `Jogando no servidor ${enderecoServidor}`
          : `Jogando ${instanciaAtiva.name}`,
        estado: `${instanciaAtiva.loader_type || instanciaAtiva.mc_type} ${instanciaAtiva.version}`,
      });
      return;
    }

    atualizarPresenceDiscord(montarPresenceLauncher());
  }, [instanciaAtiva, montarPresenceLauncher, servidorPorInstancia, atualizarPresenceDiscord]);

  useEffect(() => {
    return () => {
      invoke("encerrar_discord_presence").catch(() => undefined);
    };
  }, []);

  const handleProfileClick = () => {
    setMenuContaAberto((atual) => !atual);
  };

  const abrirProjeto = useCallback((origem: AbaOrigemProjeto, projeto: ProjetoConteudo) => {
    setAbaOrigemProjeto(origem);
    setProjetoDetalhe(projeto);
    setActiveTab("project-detail");
  }, []);

  const menuItems = [
    { id: "home", icon: Home, label: "Início" },
    { id: "instances", icon: Library, label: "Biblioteca" },
    { id: "explore", icon: Search, label: "Explorar" },
    { id: "favorites", icon: Heart, label: "Favoritos" },
    { id: "skins", icon: Avatar, label: "Skins" },
  ];

  return (
    <div className="app-shell relative flex h-screen w-full overflow-hidden text-white">
      <aside
        className={cn(
          "relative z-20 flex flex-col border-r border-white/15 bg-[#101010] transition-[width] duration-200",
          barraLateralExpandida ? "w-[228px]" : "w-[82px]"
        )}
      >
        <div
          className={cn(
            "border-b border-white/10 py-3",
            barraLateralExpandida ? "px-3" : "px-2"
          )}
        >
          <button
            onClick={() => setBarraLateralExpandida((atual) => !atual)}
            className={cn(
              "flex h-11 border border-white/15 bg-[#171717] text-white/70 hover:text-white",
              barraLateralExpandida ? "w-full items-center justify-between px-3" : "w-full items-center justify-center"
            )}
            title={barraLateralExpandida ? "Recolher sidebar" : "Expandir sidebar"}
          >
            {barraLateralExpandida ? (
              <>
                <span className="text-[11px] font-bold uppercase tracking-wide">Menu</span>
                <ChevronLeft size={16} />
              </>
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
        </div>

        <nav
          className={cn(
            "flex flex-1 flex-col gap-2 py-3",
            barraLateralExpandida ? "px-3" : "px-2 items-center"
          )}
        >
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "group relative flex border transition-colors duration-150",
                barraLateralExpandida
                  ? "w-full items-center gap-3 px-3 py-2.5 text-left"
                  : "h-11 w-11 items-center justify-center",
                activeTab === item.id
                  ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-300"
                  : "border-white/10 bg-[#171717] text-white/65 hover:border-white/25 hover:text-white"
              )}
              title={item.label}
            >
              <item.icon size={19} />
              {barraLateralExpandida && (
                <span className="text-[11px] font-bold uppercase tracking-wide">{item.label}</span>
              )}
              {activeTab === item.id && (
                <motion.div
                  layoutId="indicador-menu-ativo"
                  className="absolute -left-[2px] inset-y-0 w-[3px] bg-emerald-400"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          ))}
        </nav>

        <div
          className={cn(
            "flex flex-col gap-2 border-t border-white/10 py-3",
            barraLateralExpandida ? "px-3" : "px-2 items-center"
          )}
        >
          <button
            onClick={() => setActiveTab("settings")}
            className={cn(
              "flex border transition-colors duration-150",
              barraLateralExpandida
                ? "w-full items-center gap-3 px-3 py-2.5 text-left"
                : "h-11 w-11 items-center justify-center",
              activeTab === "settings"
                ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-300"
                : "border-white/10 bg-[#171717] text-white/65 hover:border-white/25 hover:text-white"
            )}
            title="Configurações"
          >
            <Settings size={19} />
            {barraLateralExpandida && (
              <span className="text-[11px] font-bold uppercase tracking-wide">Configurações</span>
            )}
          </button>

          <div
            ref={menuContaRef}
            className={cn("relative", barraLateralExpandida ? "w-full" : "")}
          >
            <button
              onClick={handleProfileClick}
              className={cn(
                "flex border transition-colors",
                barraLateralExpandida
                  ? "w-full items-center gap-3 px-3 py-2.5 text-left"
                  : "h-11 w-11 items-center justify-center",
                user
                  ? "border-emerald-400/40 bg-[#171717]"
                  : "border-white/15 bg-[#171717] hover:border-white/30"
              )}
              title={user ? user.name : "Contas Minecraft"}
            >
              {user ? (
                <img
                  src={`https://mc-heads.net/head/${user.uuid}/128`}
                  className={cn(
                    "border border-white/10 object-cover",
                    barraLateralExpandida ? "h-8 w-8" : "h-7 w-7"
                  )}
                  alt={user.name}
                />
              ) : (
                <div
                  className={cn(
                    "flex items-center justify-center border border-white/10 bg-[#0f0f0f]",
                    barraLateralExpandida ? "h-8 w-8" : "h-7 w-7"
                  )}
                >
                  <User size={18} className="text-white/70" />
                </div>
              )}
              {barraLateralExpandida && (
                <span className="truncate text-[11px] font-bold uppercase tracking-wide">
                  {user ? user.name : "Contas Minecraft"}
                </span>
              )}
            </button>

            <AnimatePresence>
              {menuContaAberto && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className={cn(
                    "absolute z-50 border border-white/15 bg-[#101010] p-2",
                    barraLateralExpandida
                      ? "bottom-[calc(100%+8px)] left-0 right-0"
                      : "bottom-0 left-[calc(100%+8px)] w-72"
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-white/70">
                      Contas Minecraft
                    </p>
                    <button
                      onClick={() => {
                        setMenuContaAberto(false);
                        setIsLoginOpen(true);
                      }}
                      className="inline-flex items-center gap-1 border border-white/20 bg-[#1a1a1a] px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                    >
                      <Plus size={10} />
                      Adicionar
                    </button>
                  </div>

                  {user ? (
                    <div className="mb-2 border border-emerald-400/30 bg-emerald-500/10 p-2">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://mc-heads.net/head/${user.uuid}/64`}
                          alt={user.name}
                          className="h-8 w-8 border border-white/20"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-white">{user.name}</p>
                          <p className="text-[10px] text-emerald-300">Conta ativa</p>
                        </div>
                        <button
                          onClick={async () => {
                            await deslogarContaMinecraft();
                            setMenuContaAberto(false);
                          }}
                          className="border border-white/20 bg-[#1a1a1a] px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                        >
                          Sair
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setMenuContaAberto(false);
                        setIsLoginOpen(true);
                      }}
                      className="mb-2 flex w-full items-center justify-center gap-2 border border-white/20 bg-[#1a1a1a] px-2 py-2 text-xs font-black uppercase tracking-wide text-white hover:border-white/40"
                    >
                      <LogIn size={12} />
                      Entrar com Microsoft
                    </button>
                  )}

                  {carregandoContasMinecraft ? (
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-white/60">
                      <Loader2 size={12} className="animate-spin" />
                      Carregando contas...
                    </div>
                  ) : contasAlternativas.length === 0 ? (
                    <p className="py-2 text-xs text-white/45">
                      {user ? "Nenhuma outra conta salva." : "Nenhuma conta salva."}
                    </p>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-y-auto scrollbar-hide">
                      {contasAlternativas.map((conta) => {
                        return (
                          <div key={conta.uuid} className="border border-white/10 bg-[#161616] p-2">
                            <div className="flex items-center gap-2">
                              <img
                                src={`https://mc-heads.net/head/${conta.uuid}/64`}
                                alt={conta.name}
                                className="h-7 w-7 border border-white/20"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-white/90">{conta.name}</p>
                                <p className="text-[10px] text-white/45">Disponível</p>
                              </div>
                              <button
                                onClick={async () => {
                                  await trocarContaMinecraft(conta.uuid);
                                  setMenuContaAberto(false);
                                }}
                                className="border border-white/20 bg-[#1c1c1c] px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                              >
                                Usar
                              </button>
                              <button
                                onClick={async () => {
                                  const confirmar = confirm(
                                    `Remover a conta "${conta.name}" do launcher?`
                                  );
                                  if (!confirmar) return;
                                  await removerContaMinecraft(conta.uuid);
                                }}
                                className="border border-red-400/35 bg-red-500/10 px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-200 hover:text-red-100"
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 overflow-hidden">
        <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence>
          {atualizacaoDisponivel && (
            <motion.div
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              className="absolute left-6 right-6 top-4 z-40"
            >
              <div className="mx-auto max-w-3xl border border-emerald-300/40 bg-[#101010] p-4">
                <p className="text-xs font-black uppercase tracking-wide text-emerald-300">
                  Atualização disponível
                </p>
                <p className="mt-1 text-sm text-white">
                  A versão <span className="font-bold">{atualizacaoDisponivel.version}</span> do launcher já está pronta.
                </p>

                {erroAtualizacao && (
                  <p className="mt-2 text-xs text-red-300">{erroAtualizacao}</p>
                )}

                {instalandoAtualizacao && (
                  <p className="mt-2 text-xs text-white/70">
                    Baixando atualização... {textoProgressoAtualizacao ?? ""}
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setAtualizacaoDisponivel(null);
                      setErroAtualizacao(null);
                      setProgressoAtualizacao(null);
                    }}
                    className="border border-white/20 bg-[#171717] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white/80 hover:text-white"
                  >
                    Depois
                  </button>
                  <button
                    onClick={instalarAtualizacao}
                    disabled={instalandoAtualizacao}
                    className={cn(
                      "border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors",
                      instalandoAtualizacao
                        ? "cursor-not-allowed border-white/20 bg-[#171717] text-white/40"
                        : "border-emerald-400 bg-emerald-500 text-[#07120a] hover:bg-emerald-400"
                    )}
                  >
                    {instalandoAtualizacao ? "Atualizando..." : "Atualizar e reiniciar"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {activeTab !== "instance-manager" && activeTab !== "skins" && (
          <header className="glass-topbar flex h-[68px] items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-black tracking-tight text-white">
                {TITULOS_ABA[activeTab] ?? ""}
              </h2>

              {instanciaAtiva && (
                <button
                  onClick={() => {
                    setManagedInstanceId(instanciaAtiva.id);
                    setActiveTab("instance-manager");
                  }}
                  className="inline-flex items-center gap-2 border border-emerald-300/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                >
                  <Activity size={13} />
                  Em execução: {instanciaAtiva.name}
                </button>
              )}
            </div>

            <div className="text-sm text-white/70">
              {user ? `Conta: ${user.name}` : "Conta desconectada"}
            </div>
          </header>
        )}

        <AnimatePresence>
          {instanciaAtiva && activeTab !== "instance-manager" && activeTab !== "skins" && (
            <motion.div
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              className="pointer-events-none absolute right-6 top-5 z-30"
            >
              <div className="pointer-events-auto flex items-center gap-3 border border-emerald-300/35 bg-[#101010] px-3 py-2">
                <div className="relative h-9 w-9 overflow-hidden border border-white/20">
                  <img
                    src={instanciaAtiva.icon || "/dome.svg"}
                    alt={instanciaAtiva.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-black uppercase tracking-wide text-emerald-300">
                    Sessão ativa
                  </p>
                  <p className="truncate text-sm font-semibold">{instanciaAtiva.name}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={cn(
            "flex-1 overflow-y-auto scrollbar-hide",
            activeTab === "instance-manager" ? "" : "px-6 pb-24 pt-6"
          )}
        >
          <AnimatePresence mode="wait">
            {activeTab === "home" && (
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="h-full"
              >
                <HomePage
                  user={user}
                  instances={instances}
                  instanciaAtivaId={instanciaAtiva?.id ?? null}
                  onSelectInstance={(instance) => {
                    setSelectedInstance(instance);
                    setManagedInstanceId(instance.id);
                    setActiveTab("instance-manager");
                  }}
                  onLaunch={(id) => {
                    if (!user) {
                      setIsLoginOpen(true);
                      return;
                    }
                    iniciarInstancia(id);
                  }}
                  onLaunchServer={(id, address) => {
                    if (!user) {
                      setIsLoginOpen(true);
                      return;
                    }
                    iniciarInstanciaServidor(id, address);
                  }}
                  onLogin={() => setIsLoginOpen(true)}
                  onExplore={() => setActiveTab("explore")}
                  onAbrirProjeto={(projeto) => abrirProjeto("home", projeto)}
                />
              </motion.div>
            )}

            {activeTab === "instances" && (
              <motion.div
                key="instances"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <LibraryPage
                  instances={instances}
                  instanciaAtivaId={instanciaAtiva?.id ?? null}
                  onSelectInstance={(instance) => {
                    setSelectedInstance(instance);
                  }}
                  onAbrirGerenciadorInstancia={(instance) => {
                    setManagedInstanceId(instance.id);
                    setActiveTab("instance-manager");
                  }}
                  onLaunch={(id) => iniciarInstancia(id)}
                  onDelete={(id) => remove(id)}
                  onCreateNew={() => setIsCreateOpen(true)}
                  user={user}
                  onLogin={() => setIsLoginOpen(true)}
                />
              </motion.div>
            )}

            {activeTab === "explore" && (
              <motion.div
                key="explore"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <Explore
                  onAtualizarPresencaExplore={setContextoExplore}
                  onAbrirProjeto={(projeto) => abrirProjeto("explore", projeto)}
                />
              </motion.div>
            )}

            {activeTab === "favorites" && (
              <motion.div
                key="favorites"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <Favorites
                  onAbrirProjeto={(projeto) => abrirProjeto("favorites", projeto)}
                />
              </motion.div>
            )}

            {activeTab === "project-detail" && projetoDetalhe && (
              <motion.div
                key={`project-detail-${projetoDetalhe.id}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <ProjetoDetalheModal
                  projeto={projetoDetalhe}
                  instancias={instances}
                  usuarioLogado={Boolean(user)}
                  onSolicitarLogin={() => setIsLoginOpen(true)}
                  onVoltar={() => {
                    setActiveTab(abaOrigemProjeto);
                    setProjetoDetalhe(null);
                  }}
                />
              </motion.div>
            )}

            {activeTab === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <SettingsPage />
              </motion.div>
            )}

            {activeTab === "skins" && (
              <motion.div
                key="skins"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <SkinManager user={user} />
              </motion.div>
            )}

            {activeTab === "instance-manager" && managedInstanceId && (
              <motion.div
                key="instance-manager"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-full"
              >
                <InstanceManager
                  instanceId={managedInstanceId}
                  onBack={() => setActiveTab("instances")}
                  onInstanceUpdate={() => {
                    window.location.reload();
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {selectedInstance &&
            activeTab !== "instance-manager" &&
            activeTab !== "home" &&
            activeTab !== "project-detail" && (
            <motion.footer
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="pointer-events-none absolute bottom-0 left-0 right-0 p-6"
            >
              <div className="pointer-events-auto mx-auto max-w-xl">
                <div className="flex items-center gap-3 border border-white/15 bg-[#101010] p-2">
                  <div className="ml-1 h-10 w-10 shrink-0 overflow-hidden border border-white/10">
                    <img src={selectedInstance.icon} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{selectedInstance.name}</p>
                    <p className="text-[10px] text-white/40">
                      {selectedInstance.loader_type || selectedInstance.mc_type} •{" "}
                      {selectedInstance.version}
                    </p>
                  </div>

                  <div className="h-8 w-px bg-white/15" />

                  <button
                    onClick={() => {
                      if (!user) {
                        setIsLoginOpen(true);
                        return;
                      }
                      iniciarInstancia(selectedInstance.id);
                    }}
                    className={cn(
                      "group flex items-center gap-3 border px-5 py-2.5 text-sm font-black transition-colors",
                      user
                        ? "border-emerald-400 bg-emerald-500 text-[#07120a] hover:bg-emerald-400"
                        : "border-white/15 bg-[#1b1b1b] text-white hover:bg-[#252525]"
                    )}
                  >
                    {!user ? (
                      <LogIn size={18} />
                    ) : (
                      <Play
                        fill="currentColor"
                        size={18}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    )}
                    <span>{!user ? "LOGIN" : "JOGAR"}</span>
                  </button>
                </div>
              </div>
            </motion.footer>
          )}
        </AnimatePresence>
      </main>

      {activeTab !== "instance-manager" && (
        <SocialSidebar usuarioMinecraft={user} />
      )}
      </div>

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => {
          setIsLoginOpen(false);
        }}
        onLoginConcluido={(conta) => {
          setUser(conta);
          atualizarSessaoMinecraft();
        }}
      />
      <CreateInstanceModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <CreatingInstancesOverlay />
    </div>
  );
}
