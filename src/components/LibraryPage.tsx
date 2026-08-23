import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import {
  Play,
  Trash2,
  Gamepad2,
  Clock,
  LayoutGrid,
  List,
  Search,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  GripVertical,
  FolderOpen,
  X,
  Pencil,
  Plus,
  Box,
  Upload,
  Download,
  Loader2,
} from "../iconesPixelados";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Instance } from "../hooks/useLauncher";
import { cn } from "../lib/utils";
import {
  finalizarImportacoes,
  iniciarImportacoes,
  observarImportacoes,
  obterImportacoesEmAndamento,
} from "../stores/importacoesInstancias";

// Tipos
type ViewMode = "grid" | "list";
type SortKey = "manual" | "name" | "last_played" | "version" | "loader";
type SortDir = "asc" | "desc";

interface InstanceGroup {
  id: string;
  name: string;
  collapsed: boolean;
  instanceIds: string[];
}

interface LibraryState {
  groups: InstanceGroup[];
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDir: SortDir;
}

interface InstanciaImportavelExterna {
  idExterno: string;
  launcher: string;
  nome: string;
  versaoMinecraft: string;
  loaderType?: string;
  loaderVersion?: string;
  icone?: string;
  caminhoOrigem: string;
  caminhoJogo: string;
}

interface ResultadoImportacaoInstancia {
  idExterno: string;
  launcher: string;
  nomeOrigem: string;
  sucesso: boolean;
  instanciaId?: string;
  mensagem: string;
}

interface MenuContextoInstancia {
  instancia: Instance;
  x: number;
  y: number;
}

function deduplicarIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// Chave de storage
const STORAGE_KEY = "dome-library-state";

// Estado padrão
const defaultState: LibraryState = {
  groups: [
    { id: "default", name: "Instâncias", collapsed: false, instanceIds: [] },
  ],
  viewMode: "grid",
  sortKey: "name",
  sortDir: "asc",
};

// Carregar estado salvo
function carregarEstado(): LibraryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const estado = JSON.parse(raw) as LibraryState;
      return {
        ...estado,
        groups: (estado.groups || []).map((grupo) => ({
          ...grupo,
          instanceIds: deduplicarIds(grupo.instanceIds || []),
        })),
      };
    }
  } catch {}
  return defaultState;
}

// Salvar estado
function salvarEstado(state: LibraryState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatarTempoJogadoTotal(segundos: number | undefined): string {
  const total = Math.max(0, Math.floor(segundos ?? 0));
  if (total === 0) return "0 min";
  if (total < 60) return "<1 min";

  const minutos = Math.floor(total / 60);
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  if (horas < 24) {
    return minutosRestantes > 0 ? `${horas}h ${minutosRestantes}m` : `${horas}h`;
  }

  const dias = Math.floor(horas / 24);
  const horasRestantes = horas % 24;
  return horasRestantes > 0 ? `${dias}d ${horasRestantes}h` : `${dias}d`;
}

function calcularTempoJogadoParaExibicao(
  instance: Instance,
  ativa: boolean,
  agoraSegundos: number
): number {
  const totalBase = Math.max(0, Math.floor(instance.tempo_total_jogado_segundos ?? 0));
  if (!ativa || !instance.sessao_iniciada_em) return totalBase;

  const inicioSessaoMs = new Date(instance.sessao_iniciada_em).getTime();
  if (Number.isNaN(inicioSessaoMs)) return totalBase;

  const acrescimo = Math.max(0, agoraSegundos - Math.floor(inicioSessaoMs / 1000));
  return totalBase + acrescimo;
}

// Props
interface LibraryPageProps {
  instances: Instance[];
  instanciaAtivaId: string | null;
  onSelectInstance: (instance: Instance) => void;
  onAbrirGerenciadorInstancia: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  onAtualizarInstancias: () => Promise<void>;
  user: any;
  onLogin: () => void;
}

export default function LibraryPage({
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onAbrirGerenciadorInstancia,
  onLaunch,
  onDelete,
  onCreateNew,
  onAtualizarInstancias,
  user,
  onLogin,
}: LibraryPageProps) {
  const [state, setState] = useState<LibraryState>(carregarEstado);
  const [busca, setBusca] = useState("");
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null);
  const [nomeGrupo, setNomeGrupo] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [grupoArrastadoId, setGrupoArrastadoId] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [menuContexto, setMenuContexto] = useState<MenuContextoInstancia | null>(null);
  const [grupoExclusao, setGrupoExclusao] = useState<InstanceGroup | null>(null);
  const [modalEscolhaImportacaoAberto, setModalEscolhaImportacaoAberto] = useState(false);
  const [modalImportacaoAberto, setModalImportacaoAberto] = useState(false);
  const [instanciaSelecionadaId, setInstanciaSelecionadaId] = useState<string | null>(null);
  const [carregandoImportaveis, setCarregandoImportaveis] = useState(false);
  const [instanciasImportaveis, setInstanciasImportaveis] = useState<
    InstanciaImportavelExterna[]
  >([]);
  const instanciasEmImportacao = useSyncExternalStore(
    observarImportacoes,
    obterImportacoesEmAndamento,
    obterImportacoesEmAndamento
  );
  const importandoInstancias = instanciasEmImportacao.length > 0;
  const [pastasAdicionaisImportacao, setPastasAdicionaisImportacao] = useState<string[]>([]);
  const [idsSelecionadosImportacao, setIdsSelecionadosImportacao] = useState<Set<string>>(
    new Set()
  );
  const [resultadoImportacao, setResultadoImportacao] = useState<
    ResultadoImportacaoInstancia[]
  >([]);
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);
  const [arrastoManualAtivo, setArrastoManualAtivo] = useState(false);
  const [agoraSegundos, setAgoraSegundos] = useState(() =>
    Math.floor(Date.now() / 1000)
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Salvar estado ao mudar
  useEffect(() => {
    salvarEstado(state);
  }, [state]);

  useEffect(() => {
    const intervalo = window.setInterval(() => {
      setAgoraSegundos(Math.floor(Date.now() / 1000));
    }, 15_000);
    return () => window.clearInterval(intervalo);
  }, []);

  useEffect(() => {
    if (instances.length === 0) {
      setInstanciaSelecionadaId(null);
      return;
    }

    const existeSelecionada = instanciaSelecionadaId
      ? instances.some((instancia) => instancia.id === instanciaSelecionadaId)
      : false;

    if (existeSelecionada) return;

    const ativaExiste = instanciaAtivaId
      ? instances.some((instancia) => instancia.id === instanciaAtivaId)
      : false;
    setInstanciaSelecionadaId(ativaExiste ? instanciaAtivaId : instances[0]?.id || null);
  }, [instances, instanciaAtivaId, instanciaSelecionadaId]);

  // Garantir que todas as instâncias estejam em algum grupo
  useEffect(() => {
    const idsUnicosInstancias = deduplicarIds(instances.map((i) => i.id));
    const idsNosGrupos = new Set(
      state.groups.flatMap((g) => deduplicarIds(g.instanceIds))
    );
    const orfaos = idsUnicosInstancias.filter((id) => !idsNosGrupos.has(id));

    if (orfaos.length > 0) {
      setState((prev) => {
        const grupos = [...prev.groups];
        // Adicionar ao grupo padrão
        const defaultIdx = grupos.findIndex((g) => g.id === "default");
        if (defaultIdx >= 0) {
          grupos[defaultIdx] = {
            ...grupos[defaultIdx],
            instanceIds: deduplicarIds([
              ...grupos[defaultIdx].instanceIds,
              ...orfaos,
            ]),
          };
        } else {
          grupos.unshift({
            id: "default",
            name: "Instâncias",
            collapsed: false,
            instanceIds: orfaos,
          });
        }
        return { ...prev, groups: grupos };
      });
    }

    // Limpar IDs de instâncias que não existem mais
    const idsExistentes = new Set(instances.map((i) => i.id));
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => ({
        ...g,
        instanceIds: deduplicarIds(
          g.instanceIds.filter((id) => idsExistentes.has(id))
        ),
      })),
    }));
  }, [instances]);

  // Ordenar instâncias
  const ordenar = useCallback(
    (ids: string[]): Instance[] => {
      const map = new Map(instances.map((i) => [i.id, i]));
      const lista = deduplicarIds(ids)
        .map((id) => map.get(id))
        .filter(Boolean) as Instance[];

      if (state.sortKey === "manual") return lista;

      lista.sort((a, b) => {
        let cmp = 0;
        switch (state.sortKey) {
          case "manual":
            break;
          case "name":
            cmp = a.name.localeCompare(b.name);
            break;
          case "last_played":
            cmp =
              new Date(b.last_played || 0).getTime() -
              new Date(a.last_played || 0).getTime();
            break;
          case "version":
            cmp = a.version.localeCompare(b.version);
            break;
          case "loader":
            cmp = (a.loader_type || "Vanilla").localeCompare(
              b.loader_type || "Vanilla"
            );
            break;
        }
        return state.sortDir === "asc" ? cmp : -cmp;
      });

      return lista;
    },
    [instances, state.sortKey, state.sortDir]
  );

  // Filtrar por busca
  const filtrar = useCallback(
    (lista: Instance[]): Instance[] => {
      if (!busca.trim()) return lista;
      const q = busca.toLowerCase();
      return lista.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.version.includes(q) ||
          (i.loader_type || "").toLowerCase().includes(q)
      );
    },
    [busca]
  );

  // Criar novo grupo
  const criarGrupo = () => {
    const id = `group-${Date.now()}`;
    setState((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        { id, name: "Novo Grupo", collapsed: false, instanceIds: [] },
      ],
    }));
    setEditandoGrupo(id);
    setNomeGrupo("Novo Grupo");
    setTimeout(() => inputRef.current?.select(), 50);
  };

  // Renomear grupo
  const salvarNomeGrupo = (groupId: string) => {
    if (!nomeGrupo.trim()) return;
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, name: nomeGrupo.trim() } : g
      ),
    }));
    setEditandoGrupo(null);
  };

  // Deletar grupo preservando as instâncias em outro grupo disponível
  const deletarGrupo = (groupId: string) => {
    setState((prev) => {
      if (prev.groups.length <= 1) return prev;

      const grupo = prev.groups.find((g) => g.id === groupId);
      const grupoDestino = prev.groups.find((g) => g.id !== groupId);
      if (!grupo || !grupoDestino) return prev;

      const promoverDestinoComoPadrao = groupId === "default";
      return {
        ...prev,
        groups: prev.groups
          .filter((g) => g.id !== groupId)
          .map((g) => {
            if (g.id === grupoDestino.id) {
              return {
                ...g,
                id: promoverDestinoComoPadrao ? "default" : g.id,
                instanceIds: deduplicarIds([
                  ...g.instanceIds,
                  ...grupo.instanceIds,
                ]),
              };
            }
            return g;
          }),
      };
    });
  };

  // Toggle colapsar grupo
  const toggleGrupo = (groupId: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
      ),
    }));
  };

  const moverInstanciaParaGrupo = (idArrastado: string, targetGroupId: string) => {
    setState((prev) => {
      // Remover a instância de todos os grupos
      const gruposSemItem = prev.groups.map((g) => ({
        ...g,
        instanceIds: g.instanceIds.filter((id) => id !== idArrastado),
      }));

      // Adicionar no grupo alvo
      return {
        ...prev,
        sortKey: "manual",
        groups: gruposSemItem.map((g) =>
          g.id === targetGroupId
            ? {
                ...g,
                instanceIds: deduplicarIds([...g.instanceIds, idArrastado]),
              }
            : g
        ),
      };
    });
  };

  const moverInstanciaDuranteArrasto = (targetInstanceId: string, targetGroupId: string) => {
    if (!arrastoManualAtivo || !draggedId || draggedId === targetInstanceId) return;

    setState((prev) => {
      const gruposSemInstancia = prev.groups.map((grupo) => ({
        ...grupo,
        instanceIds: grupo.instanceIds.filter((id) => id !== draggedId),
      }));

      return {
        ...prev,
        sortKey: "manual",
        groups: gruposSemInstancia.map((grupo) => {
          if (grupo.id !== targetGroupId) return grupo;

          const ids = [...grupo.instanceIds];
          const indiceDestino = ids.indexOf(targetInstanceId);
          ids.splice(indiceDestino < 0 ? ids.length : indiceDestino, 0, draggedId);
          return { ...grupo, instanceIds: deduplicarIds(ids) };
        }),
      };
    });
  };

  const iniciarArrastoManual = (instanceId: string) => {
    setDraggedId(instanceId);
    setArrastoManualAtivo(true);
  };

  const finalizarArrastoManual = useCallback(() => {
    setArrastoManualAtivo(false);
    setDraggedId(null);
    setDragOverGroup(null);
  }, []);

  useEffect(() => {
    if (!arrastoManualAtivo) return;
    const aoSoltarMouse = () => finalizarArrastoManual();
    window.addEventListener("mouseup", aoSoltarMouse);
    return () => window.removeEventListener("mouseup", aoSoltarMouse);
  }, [arrastoManualAtivo, finalizarArrastoManual]);

  useEffect(() => {
    if (!arrastoManualAtivo) return;
    const cursorAnterior = document.body.style.cursor;
    const userSelectAnterior = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursorAnterior;
      document.body.style.userSelect = userSelectAnterior;
    };
  }, [arrastoManualAtivo]);

  useEffect(() => {
    if (!menuContexto) return;
    const fecharAoPressionarEscape = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setMenuContexto(null);
    };
    const fecharAoRolar = () => setMenuContexto(null);
    window.addEventListener("keydown", fecharAoPressionarEscape);
    window.addEventListener("scroll", fecharAoRolar, true);
    return () => {
      window.removeEventListener("keydown", fecharAoPressionarEscape);
      window.removeEventListener("scroll", fecharAoRolar, true);
    };
  }, [menuContexto]);

  const handleGrupoMouseEnter = (groupId: string) => {
    if (!arrastoManualAtivo || !draggedId) return;
    setDragOverGroup(groupId);
  };

  const handleGrupoMouseUp = (groupId: string) => {
    if (!arrastoManualAtivo || !draggedId) return;
    moverInstanciaParaGrupo(draggedId, groupId);
    finalizarArrastoManual();
  };

  const moverGrupoDuranteArrasto = (grupoDestino: string) => {
    if (!grupoArrastadoId || grupoArrastadoId === grupoDestino) return;

    setState((anterior) => {
      const grupos = [...anterior.groups];
      const indiceOrigem = grupos.findIndex((grupo) => grupo.id === grupoArrastadoId);
      const indiceDestino = grupos.findIndex((grupo) => grupo.id === grupoDestino);
      if (indiceOrigem < 0 || indiceDestino < 0 || indiceOrigem === indiceDestino) return anterior;

      const [grupoMovido] = grupos.splice(indiceOrigem, 1);
      grupos.splice(indiceDestino, 0, grupoMovido);
      return { ...anterior, groups: grupos };
    });
  };

  useEffect(() => {
    if (!grupoArrastadoId) return;

    const finalizarArrastoGrupo = () => {
      setGrupoArrastadoId(null);
    };
    const cursorAnterior = document.body.style.cursor;
    const userSelectAnterior = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("mouseup", finalizarArrastoGrupo);

    return () => {
      window.removeEventListener("mouseup", finalizarArrastoGrupo);
      document.body.style.cursor = cursorAnterior;
      document.body.style.userSelect = userSelectAnterior;
    };
  }, [grupoArrastadoId]);

  // Alternar ordenação
  const alternarSort = (key: SortKey) => {
    setState((prev) => ({
      ...prev,
      sortKey: key,
      sortDir: prev.sortKey === key && prev.sortDir === "asc" ? "desc" : "asc",
    }));
  };

  // Labels de sort
  const sortLabels: Record<SortKey, string> = {
    manual: "Manual",
    name: "Nome",
    last_played: "Último jogado",
    version: "Versão",
    loader: "Loader",
  };

  const carregarInstanciasImportaveis = async (
    caminhosAdicionais = pastasAdicionaisImportacao
  ) => {
    setCarregandoImportaveis(true);
    setErroImportacao(null);
    try {
      const lista = await invoke<InstanciaImportavelExterna[]>(
        "listar_instancias_importaveis",
        { caminhosAdicionais }
      );
      setInstanciasImportaveis(lista || []);
      setIdsSelecionadosImportacao(new Set((lista || []).map((item) => item.idExterno)));
    } catch (erro) {
      setErroImportacao(
        erro instanceof Error
          ? erro.message
          : "Não foi possível listar instâncias para importação."
      );
      setInstanciasImportaveis([]);
      setIdsSelecionadosImportacao(new Set());
    } finally {
      setCarregandoImportaveis(false);
    }
  };

  const abrirModalImportacao = () => {
    if (importandoInstancias) return;
    setModalEscolhaImportacaoAberto(true);
  };

  const abrirModalImportacaoInstancias = async () => {
    setModalEscolhaImportacaoAberto(false);
    setModalImportacaoAberto(true);
    setResultadoImportacao([]);
    setErroImportacao(null);
    await carregarInstanciasImportaveis();
  };

  const apontarPastaInstancias = async () => {
    const pasta = await openDialog({
      directory: true,
      multiple: false,
      title: "Selecionar instalação do launcher",
    });
    if (typeof pasta !== "string") return;

    const proximasPastas = Array.from(new Set([...pastasAdicionaisImportacao, pasta]));
    setPastasAdicionaisImportacao(proximasPastas);
    await carregarInstanciasImportaveis(proximasPastas);
  };

  const removerPastaApontada = async (pasta: string) => {
    const proximasPastas = pastasAdicionaisImportacao.filter((item) => item !== pasta);
    setPastasAdicionaisImportacao(proximasPastas);
    await carregarInstanciasImportaveis(proximasPastas);
  };

  const alternarSelecaoImportacao = (idExterno: string) => {
    setIdsSelecionadosImportacao((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(idExterno)) {
        proximo.delete(idExterno);
      } else {
        proximo.add(idExterno);
      }
      return proximo;
    });
  };

  const selecionarTodasImportaveis = () => {
    if (idsSelecionadosImportacao.size === instanciasImportaveis.length) {
      setIdsSelecionadosImportacao(new Set());
      return;
    }
    setIdsSelecionadosImportacao(
      new Set(instanciasImportaveis.map((instancia) => instancia.idExterno))
    );
  };

  const importarSelecionadas = async () => {
    const selecionadas = instanciasImportaveis.filter((instancia) =>
      idsSelecionadosImportacao.has(instancia.idExterno)
    );
    if (selecionadas.length === 0) return;

    iniciarImportacoes(selecionadas);
    setModalImportacaoAberto(false);
    setModalEscolhaImportacaoAberto(false);
    setErroImportacao(null);
    setResultadoImportacao([]);

    await new Promise<void>((resolver) => window.requestAnimationFrame(() => resolver()));

    try {
      const resultados = await invoke<ResultadoImportacaoInstancia[]>(
        "importar_instancias_externas",
        { instancias: selecionadas }
      );
      setResultadoImportacao(resultados || []);
      await onAtualizarInstancias();
      await new Promise<void>((resolver) => window.requestAnimationFrame(() => resolver()));
    } catch (erro) {
      setErroImportacao(
        erro instanceof Error
          ? erro.message
          : "Falha ao importar as instâncias selecionadas."
      );
      setResultadoImportacao([]);
    } finally {
      finalizarImportacoes();
    }
  };

  // ===== EXPORTAR / IMPORTAR POR ARQUIVO =====
  const [exportandoId, setExportandoId] = useState<string | null>(null);
  const [importandoArquivo, setImportandoArquivo] = useState(false);

  const exportarInstancia = async (instanceId: string) => {
    setExportandoId(instanceId);
    try {
      const resultado = await invoke<{
        sucesso: boolean;
        caminhoArquivo?: string;
        mensagem: string;
      }>("exportar_instancia", { instanceId, destino: null });
      if (resultado.sucesso) {
        alert(`✅ ${resultado.mensagem}\n\nSalvo em: ${resultado.caminhoArquivo}`);
      } else {
        alert(`❌ ${resultado.mensagem}`);
      }
    } catch (erro) {
      alert(`Erro ao exportar: ${erro instanceof Error ? erro.message : String(erro)}`);
    } finally {
      setExportandoId(null);
    }
  };

  const importarArquivoDome = async () => {
    try {
      // Usar dialog nativo do Tauri para selecionar arquivo
      const caminho = await openDialog({
        title: "Selecionar arquivo .dome",
        filters: [{ name: "Dome Instance", extensions: ["dome", "zip"] }],
        multiple: false,
        directory: false,
      });
      if (!caminho) return;

      setImportandoArquivo(true);
      const resultado = await invoke<{
        sucesso: boolean;
        instanciaId?: string;
        mensagem: string;
      }>("importar_instancia_arquivo", { caminhoArquivo: caminho });

      if (resultado.sucesso) {
        alert(`✅ ${resultado.mensagem}`);
        window.location.reload();
      } else {
        alert(`❌ ${resultado.mensagem}`);
      }
    } catch (erro) {
      alert(`Erro ao importar: ${erro instanceof Error ? erro.message : String(erro)}`);
    } finally {
      setImportandoArquivo(false);
    }
  };

  const exportarInstanciaSelecionada = async () => {
    if (!instanciaSelecionadaId) return;
    await exportarInstancia(instanciaSelecionadaId);
  };

  const selecionarInstancia = (instancia: Instance) => {
    setInstanciaSelecionadaId(instancia.id);
    onSelectInstance(instancia);
  };

  const abrirMenuContexto = (evento: React.MouseEvent, instancia: Instance) => {
    evento.preventDefault();
    evento.stopPropagation();
    selecionarInstancia(instancia);

    const larguraMenu = 248;
    const alturaMenu = Math.min(430, 250 + state.groups.length * 34);
    setMenuContexto({
      instancia,
      x: Math.max(8, Math.min(evento.clientX, window.innerWidth - larguraMenu - 8)),
      y: Math.max(8, Math.min(evento.clientY, window.innerHeight - alturaMenu - 8)),
    });
  };

  const jogarPeloMenu = (instancia: Instance) => {
    setMenuContexto(null);
    if (!user) {
      onLogin();
      return;
    }
    onLaunch(instancia.id);
  };

  const excluirPeloMenu = (instancia: Instance) => {
    setMenuContexto(null);
    if (confirm(`Deletar "${instancia.name}"?`)) {
      onDelete(instancia.id);
    }
  };

  const totalSucessosImportacao = resultadoImportacao.filter((item) => item.sucesso).length;
  const nomeLauncher = (launcher: string) =>
    launcher === "prism"
      ? "Prism Launcher"
      : launcher === "modrinth"
        ? "Modrinth"
        : launcher === "curseforge"
          ? "CurseForge"
          : launcher;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {/* Busca */}
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar instâncias..."
            className="w-full bg-white/3 border border-white/5 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/30 placeholder:text-white/15 transition-all"
          />
          {busca && (
            <button
              onClick={() => setBusca("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Ordenação */}
        <div className="relative">
          <button
            onClick={() =>
              setMenuAberto(menuAberto === "sort" ? null : "sort")
            }
            className="flex items-center gap-1.5 px-3 py-2 bg-white/3 border border-white/5 rounded-xl text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
          >
            <ArrowUpDown size={13} />
            {sortLabels[state.sortKey]}
          </button>
          <AnimatePresence>
            {menuAberto === "sort" && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute right-0 top-full mt-1 bg-[#1a1a1c] border border-white/10 rounded-xl p-1 z-50 min-w-[140px] shadow-xl"
              >
                {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      alternarSort(key);
                      setMenuAberto(null);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                      state.sortKey === key
                        ? "text-emerald-400 bg-emerald-500/10"
                        : "text-white/50 hover:bg-white/5 hover:text-white/70"
                    }`}
                  >
                    {sortLabels[key]}
                    {state.sortKey === key && key !== "manual" && (
                      <span className="ml-auto text-[10px] opacity-50">
                        {state.sortDir === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Novo grupo */}
        <button
          onClick={criarGrupo}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/3 border border-white/5 rounded-xl text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
          title="Criar grupo"
        >
          <FolderPlus size={13} />
        </button>

        {/* View mode */}
        <div className="flex bg-white/3 border border-white/5 rounded-xl overflow-hidden">
          <button
            onClick={() => setState((p) => ({ ...p, viewMode: "grid" }))}
            className={`p-2 transition-all ${
              state.viewMode === "grid"
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setState((p) => ({ ...p, viewMode: "list" }))}
            className={`p-2 transition-all ${
              state.viewMode === "list"
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            <List size={14} />
          </button>
        </div>

        {/* Importar / Exportar */}
        <button
          onClick={abrirModalImportacao}
          disabled={importandoInstancias}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all font-bold disabled:opacity-40 disabled:cursor-wait"
        >
          {importandoInstancias ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )}
          {importandoInstancias ? `Importando ${instanciasEmImportacao.length}` : "Importar"}
        </button>

        <button
          onClick={exportarInstanciaSelecionada}
          disabled={!instanciaSelecionadaId || Boolean(exportandoId)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all font-bold disabled:opacity-40"
          title="Exportar instância selecionada"
        >
          {exportandoId ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
          Exportar
        </button>

        <button
          onClick={onCreateNew}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 hover:bg-emerald-500/20 transition-all font-bold"
        >
          <Plus size={13} />
          Nova
        </button>
      </div>

      <AnimatePresence>
        {!importandoInstancias && (resultadoImportacao.length > 0 || erroImportacao) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={cn(
              "flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-xs",
              erroImportacao || totalSucessosImportacao < resultadoImportacao.length
                ? "border-amber-400/25 bg-amber-500/8 text-amber-100"
                : "border-emerald-400/25 bg-emerald-500/8 text-emerald-100"
            )}
          >
            <div>
              <p className="font-bold">
                {erroImportacao
                  ? "A importação não foi concluída."
                  : `${totalSucessosImportacao} de ${resultadoImportacao.length} instâncias importadas.`}
              </p>
              {(erroImportacao || resultadoImportacao.find((item) => !item.sucesso)?.mensagem) && (
                <p className="mt-1 opacity-70">
                  {erroImportacao || resultadoImportacao.find((item) => !item.sucesso)?.mensagem}
                </p>
              )}
            </div>
            <button
              onClick={() => {
                setErroImportacao(null);
                setResultadoImportacao([]);
              }}
              className="rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Fechar resultado da importação"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grupos e instâncias */}
      {instances.length === 0 && instanciasEmImportacao.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-white/20 border-2 border-dashed border-white/5 rounded-2xl">
          <Box size={48} className="mb-4 opacity-20" />
          <p className="font-bold">Nenhuma instância encontrada</p>
          <p className="text-sm mt-1">
            Crie uma nova instância ou importe uma existente
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-bold hover:bg-emerald-500/20 transition-all"
            >
              <Plus size={14} />
              Criar Instância
            </button>
            <button
              onClick={abrirModalImportacao}
              disabled={importandoInstancias}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/15 rounded-xl text-white/70 text-sm font-bold hover:bg-white/10 hover:text-white transition-all disabled:opacity-40"
            >
              <Upload size={14} />
              Importar Instância
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {instanciasEmImportacao.length > 0 && (
            <SecaoImportacoesEmAndamento
              instancias={instanciasEmImportacao}
              viewMode={state.viewMode}
            />
          )}
          {state.groups.map((grupo) => {
            const instanciasOrdenadas = ordenar(grupo.instanceIds);
            const instanciasFiltradas = filtrar(instanciasOrdenadas);

            // Se filtrando e grupo vazio, ocultar
            if (busca && instanciasFiltradas.length === 0) return null;

            return (
              <GrupoWidget
                key={grupo.id}
                grupo={grupo}
                instances={instanciasFiltradas}
                viewMode={state.viewMode}
                editando={editandoGrupo === grupo.id}
                nomeEdit={nomeGrupo}
                dragOver={dragOverGroup === grupo.id}
                inputRef={
                  editandoGrupo === grupo.id ? inputRef : undefined
                }
                onToggle={() => toggleGrupo(grupo.id)}
                onRenomear={() => {
                  setEditandoGrupo(grupo.id);
                  setNomeGrupo(grupo.name);
                  setTimeout(() => inputRef.current?.select(), 50);
                }}
                onNomeChange={setNomeGrupo}
                onNomeSalvar={() => salvarNomeGrupo(grupo.id)}
                podeDeletar={state.groups.length > 1}
                onDeletar={() => setGrupoExclusao(grupo)}
                onSelect={selecionarInstancia}
                onAbrirGerenciador={onAbrirGerenciadorInstancia}
                onAbrirMenuContexto={abrirMenuContexto}
                onIniciarArrasto={iniciarArrastoManual}
                onEntrarInstanciaDuranteArrasto={(instanceId) =>
                  moverInstanciaDuranteArrasto(instanceId, grupo.id)
                }
                onMouseEnterGrupo={() => handleGrupoMouseEnter(grupo.id)}
                onMouseUpGrupo={() => handleGrupoMouseUp(grupo.id)}
                onFinalizarArrasto={finalizarArrastoManual}
                onIniciarArrastoGrupo={(evento) => {
                  if (evento.button !== 0) return;
                  evento.preventDefault();
                  evento.stopPropagation();
                  setGrupoArrastadoId(grupo.id);
                }}
                onEntrarGrupoDestino={() => {
                  if (!grupoArrastadoId) return;
                  moverGrupoDuranteArrasto(grupo.id);
                }}
                grupoSendoArrastado={grupoArrastadoId === grupo.id}
                instanciaSelecionadaId={instanciaSelecionadaId}
                instanciaAtivaId={instanciaAtivaId}
                agoraSegundos={agoraSegundos}
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {grupoExclusao && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setGrupoExclusao(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="titulo-excluir-grupo"
              className="w-full max-w-sm border border-white/12 bg-[#151516] shadow-2xl"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="border-b border-white/8 px-4 py-3">
                <p
                  id="titulo-excluir-grupo"
                  className="text-xs font-black uppercase tracking-wide text-white/85"
                >
                  Excluir grupo
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="text-xs leading-relaxed text-white/55">
                  O grupo <span className="font-bold text-white/85">{grupoExclusao.name}</span> será
                  excluído. As {grupoExclusao.instanceIds.length} instâncias serão movidas para outro
                  grupo e nenhum arquivo será apagado.
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-white/8 px-4 py-3">
                <button
                  onClick={() => setGrupoExclusao(null)}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white/45 hover:text-white/75"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    deletarGrupo(grupoExclusao.id);
                    setGrupoExclusao(null);
                  }}
                  className="border border-red-400/25 bg-red-400/8 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-red-200 transition-colors hover:bg-red-400/14"
                >
                  Excluir grupo
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {menuContexto && (
          <>
            <motion.button
              aria-label="Fechar menu da instância"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[79] cursor-default"
              onClick={() => setMenuContexto(null)}
            />
            <MenuGerenciamentoInstancia
              menu={menuContexto}
              grupos={state.groups}
              exportando={exportandoId === menuContexto.instancia.id}
              onJogar={() => jogarPeloMenu(menuContexto.instancia)}
              onGerenciar={() => {
                setMenuContexto(null);
                onAbrirGerenciadorInstancia(menuContexto.instancia);
              }}
              onAbrirLocal={() => {
                const instanceId = menuContexto.instancia.id;
                setMenuContexto(null);
                void invoke("abrir_pasta_instancia", { instanceId }).catch((erro) => {
                  console.error("Erro ao abrir local da instância:", erro);
                  alert("Não foi possível abrir o local da instância.");
                });
              }}
              onExportar={() => {
                const id = menuContexto.instancia.id;
                setMenuContexto(null);
                void exportarInstancia(id);
              }}
              onMover={(grupoId) => {
                moverInstanciaParaGrupo(menuContexto.instancia.id, grupoId);
                setMenuContexto(null);
              }}
              onExcluir={() => excluirPeloMenu(menuContexto.instancia)}
            />
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modalEscolhaImportacaoAberto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-xs p-4 flex items-center justify-center"
            onClick={() => {
              if (importandoArquivo) return;
              setModalEscolhaImportacaoAberto(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-xl bg-[#141416] border border-white/15 rounded-2xl overflow-hidden"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Importar</h3>
                  <p className="text-xs text-white/50 mt-1">
                    Escolha como deseja importar para a biblioteca.
                  </p>
                </div>
                <button
                  onClick={() => setModalEscolhaImportacaoAberto(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-5 space-y-3">
                <button
                  onClick={async () => {
                    setModalEscolhaImportacaoAberto(false);
                    await importarArquivoDome();
                  }}
                  disabled={importandoArquivo}
                  className="w-full text-left border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 transition-all disabled:opacity-40"
                >
                  <p className="text-sm font-bold flex items-center gap-2">
                    {importandoArquivo ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Upload size={14} />
                    )}
                    Importar arquivo `.dome`
                  </p>
                  <p className="text-xs text-white/55 mt-1">
                    Também aceita `.dome.zip` para compatibilidade.
                  </p>
                </button>

                <button
                  onClick={abrirModalImportacaoInstancias}
                  className="w-full text-left border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 transition-all"
                >
                  <p className="text-sm font-bold flex items-center gap-2">
                    <FolderOpen size={14} />
                    Importar de outro launcher
                  </p>
                  <p className="text-xs text-white/55 mt-1">
                    Detecta instâncias de Prism Launcher, Modrinth e CurseForge.
                  </p>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {modalImportacaoAberto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-xs p-4 flex items-center justify-center"
            onClick={() => {
              if (importandoInstancias) return;
              setModalImportacaoAberto(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-3xl bg-[#141416] border border-white/15 rounded-2xl overflow-hidden"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Importar Instâncias</h3>
                  <p className="text-xs text-white/50 mt-1">
                    Detectadas automaticamente ou nas instalações que você apontar.
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (importandoInstancias) return;
                    setModalImportacaoAberto(false);
                    setModalEscolhaImportacaoAberto(false);
                  }}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="px-5 py-4">
                <div className="mb-4 rounded-xl border border-white/10 bg-white/3 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white/80">Instalação personalizada</p>
                      <p className="mt-0.5 text-[11px] text-white/40">
                        Aponte a pasta do Prism Launcher, Modrinth, CurseForge ou a pasta de perfis.
                      </p>
                    </div>
                    <button
                      onClick={() => void apontarPastaInstancias()}
                      disabled={carregandoImportaveis}
                      className="flex shrink-0 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                    >
                      <FolderPlus size={13} />
                      Apontar pasta
                    </button>
                  </div>
                  {pastasAdicionaisImportacao.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-white/8 pt-3">
                      {pastasAdicionaisImportacao.map((pasta) => (
                        <div
                          key={pasta}
                          className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2"
                        >
                          <FolderOpen size={12} className="shrink-0 text-emerald-400/70" />
                          <span className="min-w-0 flex-1 truncate text-[10px] text-white/45">
                            {pasta}
                          </span>
                          <button
                            onClick={() => void removerPastaApontada(pasta)}
                            disabled={carregandoImportaveis}
                            className="rounded p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70 disabled:opacity-30"
                            aria-label={`Remover pasta ${pasta}`}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {erroImportacao && (
                  <div className="mb-3 border border-red-400/30 bg-red-500/10 text-red-200 text-xs px-3 py-2 rounded-lg">
                    {erroImportacao}
                  </div>
                )}

                {carregandoImportaveis ? (
                  <div className="py-12 flex items-center justify-center text-white/60 text-sm">
                    <Loader2 size={14} className="animate-spin mr-2" />
                    Buscando instâncias...
                  </div>
                ) : instanciasImportaveis.length === 0 ? (
                  <div className="py-12 text-center text-white/50 text-sm">
                    Nenhuma instância externa foi encontrada no computador.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <button
                        onClick={selecionarTodasImportaveis}
                        className="text-xs text-white/70 hover:text-white transition-colors"
                      >
                        {idsSelecionadosImportacao.size === instanciasImportaveis.length
                          ? "Desmarcar todas"
                          : "Marcar todas"}
                      </button>
                      <span className="text-[11px] text-white/40">
                        {idsSelecionadosImportacao.size}/{instanciasImportaveis.length} selecionadas
                      </span>
                    </div>

                    <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                      {instanciasImportaveis.map((instancia) => {
                        const selecionada = idsSelecionadosImportacao.has(instancia.idExterno);
                        return (
                          <button
                            key={instancia.idExterno}
                            onClick={() => alternarSelecaoImportacao(instancia.idExterno)}
                            className={cn(
                              "w-full text-left border rounded-xl px-3 py-2 transition-all",
                              selecionada
                                ? "border-emerald-400/40 bg-emerald-500/10"
                                : "border-white/10 bg-white/3 hover:bg-white/6"
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selecionada}
                                readOnly
                                className="mt-1 w-4 h-4"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-bold truncate">{instancia.nome}</p>
                                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                                    {nomeLauncher(instancia.launcher)}
                                  </span>
                                </div>
                                <p className="text-xs text-white/55 mt-0.5">
                                  MC {instancia.versaoMinecraft}
                                  {instancia.loaderType ? ` • ${instancia.loaderType}` : " • Vanilla"}
                                  {instancia.loaderVersion ? ` ${instancia.loaderVersion}` : ""}
                                </p>
                                <p className="text-[10px] text-white/35 mt-1 truncate">
                                  {instancia.caminhoOrigem}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

              </div>

              <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
                <button
                  onClick={() => void carregarInstanciasImportaveis()}
                  disabled={carregandoImportaveis || importandoInstancias}
                  className="text-xs text-white/65 hover:text-white disabled:opacity-40 transition-colors"
                >
                  Rebuscar
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={importarSelecionadas}
                    disabled={
                      importandoInstancias ||
                      carregandoImportaveis ||
                      idsSelecionadosImportacao.size === 0
                    }
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-all flex items-center gap-2",
                      importandoInstancias ||
                        carregandoImportaveis ||
                        idsSelecionadosImportacao.size === 0
                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : "bg-emerald-500 text-black hover:bg-emerald-400"
                    )}
                  >
                    {importandoInstancias ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Importando...
                      </>
                    ) : (
                      <>
                        <Upload size={12} />
                        Importar selecionadas
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SecaoImportacoesEmAndamento({
  instancias,
  viewMode,
}: {
  instancias: InstanciaImportavelExterna[];
  viewMode: ViewMode;
}) {
  return (
    <section className="mb-5" aria-live="polite" aria-label="Importações em andamento">
      <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-black uppercase tracking-wide text-white/45">
        <Loader2 size={12} className="animate-spin text-emerald-400" />
        Importando
        <span className="font-normal text-white/25">{instancias.length}</span>
      </div>
      <div
        className={cn(
          viewMode === "grid"
            ? "grid grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-2"
            : "space-y-2"
        )}
      >
        {instancias.map((instancia) => (
          <div
            key={instancia.idExterno}
            aria-disabled="true"
            className={cn(
              "pointer-events-none relative select-none overflow-hidden border border-white/8 bg-white/3 opacity-45",
              viewMode === "grid"
                ? "min-h-[150px] rounded-2xl p-4"
                : "flex min-h-16 items-center gap-3 rounded-xl px-4 py-3"
            )}
          >
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/25 text-white/35",
                viewMode === "grid" ? "h-14 w-14" : "h-10 w-10"
              )}
            >
              <Box size={viewMode === "grid" ? 24 : 18} />
            </div>
            <div className={cn("min-w-0", viewMode === "grid" ? "mt-3" : "flex-1")}>
              <p className="truncate text-sm font-bold text-white">{instancia.nome}</p>
              <p className="mt-1 truncate text-[11px] text-white/55">
                {instancia.loaderType || "Vanilla"} {instancia.versaoMinecraft}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
                <Loader2 size={10} className="animate-spin" />
                Migrando arquivos...
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MenuGerenciamentoInstancia({
  menu,
  grupos,
  exportando,
  onJogar,
  onGerenciar,
  onAbrirLocal,
  onExportar,
  onMover,
  onExcluir,
}: {
  menu: MenuContextoInstancia;
  grupos: InstanceGroup[];
  exportando: boolean;
  onJogar: () => void;
  onGerenciar: () => void;
  onAbrirLocal: () => void;
  onExportar: () => void;
  onMover: (grupoId: string) => void;
  onExcluir: () => void;
}) {
  const grupoAtual = grupos.find((grupo) =>
    grupo.instanceIds.includes(menu.instancia.id)
  );
  const classeItem =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.1 }}
      className="fixed z-[80] w-[240px] rounded-xl border border-white/15 bg-[#171719] p-1.5 shadow-2xl"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(evento) => evento.stopPropagation()}
      onContextMenu={(evento) => evento.preventDefault()}
    >
      <div className="border-b border-white/8 px-3 pb-2 pt-1.5">
        <p className="truncate text-xs font-black text-white">{menu.instancia.name}</p>
        <p className="mt-0.5 truncate text-[10px] text-white/35">
          {menu.instancia.loader_type || menu.instancia.mc_type} {menu.instancia.version}
        </p>
      </div>

      <div className="space-y-0.5 py-1">
        <button
          onClick={onJogar}
          className={cn(classeItem, "text-emerald-300 hover:bg-emerald-500/10")}
        >
          <Play size={13} fill="currentColor" />
          Jogar
        </button>
        <button
          onClick={onGerenciar}
          className={cn(classeItem, "text-white/75 hover:bg-white/7 hover:text-white")}
        >
          <Pencil size={13} />
          Gerenciar instância
        </button>
        <button
          onClick={onAbrirLocal}
          className={cn(classeItem, "text-white/75 hover:bg-white/7 hover:text-white")}
        >
          <FolderOpen size={13} />
          Abrir local do arquivo
        </button>
        <button
          onClick={onExportar}
          disabled={exportando}
          className={cn(
            classeItem,
            "text-white/75 hover:bg-white/7 hover:text-white disabled:opacity-40"
          )}
        >
          {exportando ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Exportar
        </button>
      </div>

      {grupos.length > 1 && (
        <div className="border-t border-white/8 px-1 pb-1 pt-2">
          <p className="px-2 pb-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/25">
            Mover para grupo
          </p>
          {grupos.map((grupo) => {
            const atual = grupo.id === grupoAtual?.id;
            return (
              <button
                key={grupo.id}
                onClick={() => onMover(grupo.id)}
                disabled={atual}
                className={cn(
                  classeItem,
                  atual
                    ? "cursor-default text-emerald-300/60"
                    : "text-white/60 hover:bg-white/7 hover:text-white"
                )}
              >
                <FolderOpen size={12} />
                <span className="truncate">{grupo.name}</span>
                {atual && <span className="ml-auto text-[9px] uppercase">Atual</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="border-t border-white/8 pt-1">
        <button
          onClick={onExcluir}
          className={cn(
            classeItem,
            "text-red-300/80 hover:bg-red-500/10 hover:text-red-200"
          )}
        >
          <Trash2 size={13} />
          Excluir instância
        </button>
      </div>
    </motion.div>
  );
}

// ===== WIDGET DE GRUPO =====
function GrupoWidget({
  grupo,
  instances,
  viewMode,
  editando,
  nomeEdit,
  dragOver,
  inputRef,
  onToggle,
  onRenomear,
  onNomeChange,
  onNomeSalvar,
  podeDeletar,
  onDeletar,
  onSelect,
  onAbrirGerenciador,
  onAbrirMenuContexto,
  onIniciarArrasto,
  onEntrarInstanciaDuranteArrasto,
  onMouseEnterGrupo,
  onMouseUpGrupo,
  onFinalizarArrasto,
  onIniciarArrastoGrupo,
  onEntrarGrupoDestino,
  grupoSendoArrastado,
  instanciaSelecionadaId,
  instanciaAtivaId,
  agoraSegundos,
}: {
  grupo: InstanceGroup;
  instances: Instance[];
  viewMode: ViewMode;
  editando: boolean;
  nomeEdit: string;
  dragOver: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onRenomear: () => void;
  onNomeChange: (v: string) => void;
  onNomeSalvar: () => void;
  podeDeletar: boolean;
  onDeletar: () => void;
  onSelect: (instance: Instance) => void;
  onAbrirGerenciador: (instance: Instance) => void;
  onAbrirMenuContexto: (evento: React.MouseEvent, instance: Instance) => void;
  onIniciarArrasto: (id: string) => void;
  onEntrarInstanciaDuranteArrasto: (id: string) => void;
  onMouseEnterGrupo: () => void;
  onMouseUpGrupo: () => void;
  onFinalizarArrasto: () => void;
  onIniciarArrastoGrupo: (evento: React.MouseEvent) => void;
  onEntrarGrupoDestino: () => void;
  grupoSendoArrastado: boolean;
  instanciaSelecionadaId: string | null;
  instanciaAtivaId: string | null;
  agoraSegundos: number;
}) {
  return (
    <motion.div
      layout="position"
      transition={{ layout: { duration: 0.16, ease: "easeOut" } }}
      onMouseEnter={() => {
        onMouseEnterGrupo();
        onEntrarGrupoDestino();
      }}
      onMouseUp={onMouseUpGrupo}
      className={`rounded-xl border transition-all ${
        dragOver
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-transparent"
      } ${grupoSendoArrastado ? "opacity-45" : "opacity-100"}`}
    >
      {/* Header do grupo */}
      <div className="flex items-center gap-2 py-1.5 px-1 group/header">
        <div
          onMouseDown={onIniciarArrastoGrupo}
          className={cn(
            "cursor-grab text-white/15 transition-colors hover:text-white/45",
            "active:cursor-grabbing"
          )}
          title="Arrastar grupo"
        >
          <GripVertical size={12} />
        </div>
        <button
          onClick={onToggle}
          className="p-1 text-white/25 hover:text-white/50 transition-colors"
        >
          {grupo.collapsed ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>

        {editando ? (
          <div className="flex items-center gap-1.5 flex-1">
            <input
              ref={inputRef}
              value={nomeEdit}
              onChange={(e) => onNomeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onNomeSalvar();
                if (e.key === "Escape") onNomeSalvar();
              }}
              onBlur={onNomeSalvar}
              className={cn(
                "rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-sm font-bold",
                "focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              )}
              autoFocus
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <FolderOpen size={13} className="text-white/20" />
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">
              {grupo.name}
            </span>
            <span className="text-[10px] text-white/15 font-medium">
              {instances.length}
            </span>
          </div>
        )}

        {/* Ações do grupo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onRenomear}
            className="p-1 text-white/20 hover:text-white/40 transition-colors"
            title="Renomear grupo"
          >
            <Pencil size={11} />
          </button>
          {podeDeletar && (
            <button
              onClick={onDeletar}
              className="p-1 text-white/25 hover:text-red-400 transition-colors"
              title="Excluir grupo"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      <AnimatePresence>
        {!grupo.collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {instances.length === 0 ? (
              <div
                className={cn(
                  "mx-1 mb-2 rounded-xl border border-dashed border-white/5 py-6",
                  "text-center text-xs text-white/10"
                )}
              >
                Arraste instâncias para este grupo
              </div>
            ) : viewMode === "grid" ? (
              <div
                className={cn(
                  "grid grid-cols-2 gap-2 px-1 pb-2 sm:grid-cols-3 md:grid-cols-4",
                  "lg:grid-cols-5 xl:grid-cols-6"
                )}
              >
                {instances.map((instance, i) => (
                  <CardGrid
                    key={instance.id}
                    instance={instance}
                    index={i}
                    onSelect={onSelect}
                    onAbrirGerenciador={onAbrirGerenciador}
                    onAbrirMenuContexto={onAbrirMenuContexto}
                    onIniciarArrasto={onIniciarArrasto}
                    onEntrarDuranteArrasto={onEntrarInstanciaDuranteArrasto}
                    onFinalizarArrasto={onFinalizarArrasto}
                    selecionada={instance.id === instanciaSelecionadaId}
                    ativa={instance.id === instanciaAtivaId}
                    agoraSegundos={agoraSegundos}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1 px-1 pb-2">
                {instances.map((instance, i) => (
                  <CardList
                    key={instance.id}
                    instance={instance}
                    index={i}
                    onSelect={onSelect}
                    onAbrirGerenciador={onAbrirGerenciador}
                    onAbrirMenuContexto={onAbrirMenuContexto}
                    onIniciarArrasto={onIniciarArrasto}
                    onEntrarDuranteArrasto={onEntrarInstanciaDuranteArrasto}
                    onFinalizarArrasto={onFinalizarArrasto}
                    selecionada={instance.id === instanciaSelecionadaId}
                    ativa={instance.id === instanciaAtivaId}
                    agoraSegundos={agoraSegundos}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ===== CARD GRID (estilo PrismLauncher) =====
function CardGrid({
  instance,
  index,
  onSelect,
  onAbrirGerenciador,
  onAbrirMenuContexto,
  onIniciarArrasto,
  onEntrarDuranteArrasto,
  onFinalizarArrasto,
  selecionada,
  ativa,
  agoraSegundos,
}: {
  instance: Instance;
  index: number;
  onSelect: (i: Instance) => void;
  onAbrirGerenciador: (i: Instance) => void;
  onAbrirMenuContexto: (evento: React.MouseEvent, instance: Instance) => void;
  onIniciarArrasto: (id: string) => void;
  onEntrarDuranteArrasto: (id: string) => void;
  onFinalizarArrasto: () => void;
  selecionada: boolean;
  ativa: boolean;
  agoraSegundos: number;
}) {
  const tempoExibicaoSegundos = calcularTempoJogadoParaExibicao(
    instance,
    ativa,
    agoraSegundos
  );

  return (
    <motion.div
      layout="position"
      onMouseUp={(evento) => {
        evento.stopPropagation();
        onFinalizarArrasto();
      }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.02 }}
      onClick={() => onSelect(instance)}
      onDoubleClick={() => onAbrirGerenciador(instance)}
      onContextMenu={(evento) => onAbrirMenuContexto(evento, instance)}
      onMouseEnter={() => onEntrarDuranteArrasto(instance.id)}
      className={cn(
        "group relative rounded-xl p-3 cursor-pointer transition-all flex flex-col items-center text-center border",
        selecionada
          ? "bg-emerald-500/10 border-emerald-400/30 shadow-realce-selecao"
          : "bg-white/3 hover:bg-white/5 border-white/5 hover:border-white/10"
      )}
    >
      {/* Grip para drag */}
      <div
        onMouseDown={(evento) => {
          if (evento.button !== 0) return;
          evento.stopPropagation();
          onIniciarArrasto(instance.id);
        }}
        className={cn(
          "absolute left-1.5 top-1.5 cursor-grab text-white/0 transition-colors",
          "group-hover:text-white/15 active:cursor-grabbing"
        )}
      >
        <GripVertical size={10} />
      </div>

      {/* Ícone grande */}
      <div className="mb-2 h-16 w-16">
        <div className="w-full h-full rounded-xl bg-[#151516] border border-white/10 p-2 overflow-hidden">
          <img
            src={instance.icon}
            alt={instance.name}
            draggable={false}
            className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-200"
          />
        </div>

      </div>

      {/* Nome */}
      <h3 className="font-bold text-xs truncate w-full">{instance.name}</h3>

      {/* Info */}
      <div className="flex items-center gap-1 text-[10px] text-white/25 mt-0.5">
        <Gamepad2 size={9} />
        <span className="truncate">
          {instance.loader_type || instance.mc_type} {instance.version}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-white/25 mt-0.5">
        <Clock size={9} />
        <span>{formatarTempoJogadoTotal(tempoExibicaoSegundos)}</span>
      </div>
    </motion.div>
  );
}

// ===== CARD LISTA =====
function CardList({
  instance,
  index,
  onSelect,
  onAbrirGerenciador,
  onAbrirMenuContexto,
  onIniciarArrasto,
  onEntrarDuranteArrasto,
  onFinalizarArrasto,
  selecionada,
  ativa,
  agoraSegundos,
}: {
  instance: Instance;
  index: number;
  onSelect: (i: Instance) => void;
  onAbrirGerenciador: (i: Instance) => void;
  onAbrirMenuContexto: (evento: React.MouseEvent, instance: Instance) => void;
  onIniciarArrasto: (id: string) => void;
  onEntrarDuranteArrasto: (id: string) => void;
  onFinalizarArrasto: () => void;
  selecionada: boolean;
  ativa: boolean;
  agoraSegundos: number;
}) {
  const tempoExibicaoSegundos = calcularTempoJogadoParaExibicao(
    instance,
    ativa,
    agoraSegundos
  );

  return (
    <motion.div
      layout="position"
      onMouseUp={(evento) => {
        evento.stopPropagation();
        onFinalizarArrasto();
      }}
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02 }}
      onClick={() => onSelect(instance)}
      onDoubleClick={() => onAbrirGerenciador(instance)}
      onContextMenu={(evento) => onAbrirMenuContexto(evento, instance)}
      onMouseEnter={() => onEntrarDuranteArrasto(instance.id)}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition-all border",
        selecionada
          ? "bg-emerald-500/10 border-emerald-400/30 shadow-realce-selecao"
          : "bg-white/2 hover:bg-white/4 border-white/3 hover:border-white/8"
      )}
    >
      {/* Grip */}
      <div
        onMouseDown={(evento) => {
          if (evento.button !== 0) return;
          evento.stopPropagation();
          onIniciarArrasto(instance.id);
        }}
        className="text-white/0 group-hover:text-white/15 transition-colors cursor-grab active:cursor-grabbing shrink-0"
      >
        <GripVertical size={12} />
      </div>

      {/* Ícone */}
      <div className="shrink-0">
        <div className="w-9 h-9 rounded-lg bg-[#151516] border border-white/10 p-1 overflow-hidden">
          <img
            src={instance.icon}
            alt={instance.name}
            draggable={false}
            className="w-full h-full object-contain"
          />
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-sm truncate">{instance.name}</h3>
      </div>

      {/* Tags */}
      <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/30 font-mono shrink-0">
        {instance.version}
      </span>

      <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/30 shrink-0">
        {instance.loader_type || "Vanilla"}
      </span>

      {/* Tempo jogado */}
      <div className="flex items-center gap-1 text-[10px] text-white/20 shrink-0 w-24 justify-end">
        <Clock size={9} />
        {formatarTempoJogadoTotal(tempoExibicaoSegundos)}
      </div>

    </motion.div>
  );
}
