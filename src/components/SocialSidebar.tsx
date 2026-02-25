import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { io, type Socket } from 'socket.io-client';
import { Loader2, Pencil, Users, X } from '../iconesPixelados';
import { CONFIGURACAO_SOCIAL } from '../lib/configuracaoSocial';
import { cn } from '../lib/utils';

interface ContaMinecraft {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

interface ContaMinecraftSocial {
  uuid: string;
  nome: string;
  vinculadoEm: string;
  ultimoUsoEm?: string | null;
}

type StatusPresenca = 'online' | 'ausente' | 'offline';
type TipoAtividade = 'modpack_exato' | 'instancia_personalizada' | 'launcher';

interface AtividadeSocial {
  tipo: TipoAtividade;
  instanciaId?: string | null;
  instanciaNome?: string | null;
  servidor?: string | null;
  source?: 'modrinth' | 'curseforge' | null;
  projectId?: string | null;
  versionId?: string | null;
  fileId?: string | null;
  modpackNome?: string | null;
  versaoMinecraft?: string | null;
  loader?: string | null;
  atualizadoEm: string;
}

interface PerfilSocial {
  perfilId: string;
  discordId: string;
  discordUsername: string;
  discordGlobalName?: string | null;
  discordAvatar?: string | null;
  handle: string;
  nomeSocial: string;
  contasMinecraftVinculadas: ContaMinecraftSocial[];
  contaMinecraftPrincipalUuid?: string | null;
  online: boolean;
  status?: StatusPresenca;
  aparecerOffline?: boolean;
  emJogo?: boolean;
  atividadeAtual?: AtividadeSocial | null;
  ultimoSeenEm?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

interface SessaoSocial {
  accessToken: string;
  refreshToken: string;
  expiraEm: string;
  perfil: PerfilSocial;
}

interface AmigoSocial {
  amizadeId: string;
  friendProfileId: string;
  nome: string;
  handle?: string | null;
  online: boolean;
  status?: StatusPresenca;
  atividadeAtual?: AtividadeSocial | null;
  ultimoSeenEm?: string | null;
}

interface SolicitacaoRecebida {
  id: string;
  dePerfilId: string;
  deHandle?: string | null;
  deNome: string;
  criadoEm: string;
}

interface SolicitacaoEnviada {
  id: string;
  paraPerfilId: string;
  paraHandle?: string | null;
  paraNome: string;
  criadoEm: string;
}

interface RespostaAmigosApi {
  amigos: AmigoSocial[];
  pendentesRecebidas: SolicitacaoRecebida[];
  pendentesEnviadas: SolicitacaoEnviada[];
}

interface MensagemChatApi {
  id: string;
  dePerfilId: string;
  paraPerfilId: string;
  conteudo: string;
  criadoEm: string;
}

interface RespostaChatApi {
  conversaId: string;
  mensagens: MensagemChatApi[];
}

interface RespostaSessaoRefresh {
  accessToken: string;
  expiraEm: string;
}

interface RespostaSalvarPerfilApi {
  sucesso?: boolean;
  perfil?: PerfilSocial;
}

interface RespostaStatusSocialApi {
  sucesso?: boolean;
  perfil?: PerfilSocial;
}

interface ResultadoExportacaoSyncSocial {
  caminhoArquivo: string;
  tamanhoBytes: number;
}

interface EventoSocketSyncPedido {
  pedidoId?: string;
  solicitantePerfilId?: string;
  instanciaId?: string | null;
  instanciaNome?: string | null;
}

interface EventoSocketSyncStatus {
  pedidoId?: string;
  status?: string;
  tokenUpload?: string;
  tokenDownload?: string;
}

interface AtividadeLocalLauncher {
  emJogo: boolean;
  atividadeAtual: AtividadeSocial | null;
}

interface VersaoModrinth {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: Array<{
    filename: string;
    url: string;
    primary?: boolean;
  }>;
}

interface LoaderVersionsResponse {
  versions: Array<{ version: string; stable?: boolean }>;
}

interface InstanciaResumo {
  id: string;
  name: string;
}

interface SocialSidebarProps {
  usuarioMinecraft: ContaMinecraft | null;
  className?: string;
  onFecharDrawer?: () => void;
}

const CHAVE_SESSAO_SOCIAL = 'dome:social:sessao';
const API_DOME_LAUNCHER_URL = CONFIGURACAO_SOCIAL.apiBaseUrl;
const DISCORD_CLIENT_ID = CONFIGURACAO_SOCIAL.discordClientId;
const DISCORD_REDIRECT_URI = CONFIGURACAO_SOCIAL.discordRedirectUri;
const DISCORD_SCOPES = CONFIGURACAO_SOCIAL.discordScopes;
const INTERVALO_HEARTBEAT_MS = 20_000;

function chaveNaoLidasSocial(perfilId: string): string {
  return `dome:social:nao-lidas:${perfilId}`;
}

function normalizarHandle(handle: string): string | null {
  const valor = handle.trim().toLowerCase().replace(/^@+/, '');
  if (!valor) return null;
  if (!/^[a-z0-9._]{3,24}$/.test(valor)) return null;
  return valor;
}

function normalizarUuid(uuid: string | null | undefined): string | null {
  if (!uuid) return null;
  const valor = uuid.trim().toLowerCase();
  return valor.length > 0 ? valor : null;
}

function mensagemErro(erro: unknown, padrao: string): string {
  if (erro instanceof Error && erro.message.trim()) return erro.message;
  return padrao;
}

function lerSessaoLocal(): SessaoSocial | null {
  try {
    const bruto = localStorage.getItem(CHAVE_SESSAO_SOCIAL);
    if (!bruto) return null;
    return JSON.parse(bruto) as SessaoSocial;
  } catch {
    return null;
  }
}

function salvarSessaoLocal(sessao: SessaoSocial | null): void {
  if (!sessao) {
    localStorage.removeItem(CHAVE_SESSAO_SOCIAL);
    return;
  }
  localStorage.setItem(CHAVE_SESSAO_SOCIAL, JSON.stringify(sessao));
}

function expirada(expiraEm: string): boolean {
  const data = new Date(expiraEm).getTime();
  if (!Number.isFinite(data)) return true;
  return data <= Date.now() + 20_000;
}

function tempoRelativo(data: string | null | undefined): string {
  if (!data) return 'agora';
  const dataBase = new Date(data);
  if (Number.isNaN(dataBase.getTime())) return 'agora';
  const diff = Date.now() - dataBase.getTime();
  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `ha ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `ha ${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias <= 1 ? 'ha 1 dia' : `ha ${dias} dias`;
}

function rotuloStatus(status?: StatusPresenca): string {
  if (status === 'ausente') return 'Ausente';
  if (status === 'offline') return 'Offline';
  return 'Online';
}

function classeStatus(status?: StatusPresenca): string {
  if (status === 'ausente') return 'text-amber-300';
  if (status === 'offline') return 'text-white/45';
  return 'text-emerald-300';
}

function escolherVersaoMinecraftIdeal(gameVersions: string[]): string | null {
  if (gameVersions.length === 0) return null;
  const releases = gameVersions.filter((item) => /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(item));
  if (releases.length === 0) return gameVersions[0] || null;
  releases.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return releases[0] || null;
}

function escolherVersaoLoaderIdeal(
  loader: string,
  versoes: Array<{ version: string; stable?: boolean }>,
  versaoMinecraft: string
): string | null {
  if (versoes.length === 0) return null;
  if (loader === 'forge' || loader === 'neoforge') {
    const compativel = versoes.find(
      (item) =>
        item.version.startsWith(`${versaoMinecraft}-`) || item.version.includes(versaoMinecraft)
    );
    return compativel?.version || versoes[0].version;
  }
  return versoes.find((item) => item.stable !== false)?.version || versoes[0].version;
}

function gerarNomeInstanciaDisponivel(nomeBase: string, nomesExistentes: string[]): string {
  const base = nomeBase.trim() || 'Instancia social';
  const nomes = new Set(nomesExistentes.map((item) => item.toLowerCase()));
  if (!nomes.has(base.toLowerCase())) return base;
  let sufixo = 2;
  while (nomes.has(`${base} ${sufixo}`.toLowerCase())) sufixo += 1;
  return `${base} ${sufixo}`;
}

function gerarIdInstancia(nomeInstancia: string): string {
  return encodeURIComponent(nomeInstancia.toLowerCase().replace(/\s+/g, '_'));
}

export default function SocialSidebar({ usuarioMinecraft, className, onFecharDrawer }: SocialSidebarProps) {
  const [sessao, setSessao] = useState<SessaoSocial | null>(null);
  const [perfil, setPerfil] = useState<PerfilSocial | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState<string | null>(null);
  const [mensagemPerfil, setMensagemPerfil] = useState<string | null>(null);
  const [nomeSocialEditavel, setNomeSocialEditavel] = useState('');
  const [handleEditavel, setHandleEditavel] = useState('');
  const [statusManual, setStatusManual] = useState<'online' | 'ausente'>('online');
  const [aparecerOffline, setAparecerOffline] = useState(false);
  const [salvandoStatus, setSalvandoStatus] = useState(false);

  const [amigos, setAmigos] = useState<AmigoSocial[]>([]);
  const [pendentesRecebidas, setPendentesRecebidas] = useState<SolicitacaoRecebida[]>([]);
  const [pendentesEnviadas, setPendentesEnviadas] = useState<SolicitacaoEnviada[]>([]);
  const [carregandoAmigos, setCarregandoAmigos] = useState(false);
  const [erroAmigos, setErroAmigos] = useState<string | null>(null);
  const [filtroAmigos, setFiltroAmigos] = useState('');
  const [handleNovoAmigo, setHandleNovoAmigo] = useState('');
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [mensagemSolicitacao, setMensagemSolicitacao] = useState<string | null>(null);
  const [naoLidasPorAmigo, setNaoLidasPorAmigo] = useState<Record<string, number>>({});

  const [amigoSelecionadoPerfilId, setAmigoSelecionadoPerfilId] = useState<string | null>(null);
  const [mensagensChat, setMensagensChat] = useState<MensagemChatApi[]>([]);
  const [textoChat, setTextoChat] = useState('');
  const [carregandoChat, setCarregandoChat] = useState(false);
  const [enviandoChat, setEnviandoChat] = useState(false);
  const [erroChat, setErroChat] = useState<string | null>(null);
  const [atividadeLocal, setAtividadeLocal] = useState<AtividadeLocalLauncher>({
    emJogo: false,
    atividadeAtual: null,
  });
  const [mensagemSync, setMensagemSync] = useState<string | null>(null);
  const [amigoModalAtividade, setAmigoModalAtividade] = useState<AmigoSocial | null>(null);
  const [processandoAtividade, setProcessandoAtividade] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const ultimoTokenSocketRef = useRef<string>('');
  const pedidosSyncRecebidosRef = useRef<Map<string, EventoSocketSyncPedido>>(new Map());

  const nomeExibicaoAtual = useMemo(() => {
    if (editandoPerfil && nomeSocialEditavel.trim()) return nomeSocialEditavel.trim();
    if (perfil?.nomeSocial?.trim()) return perfil.nomeSocial.trim();
    if (perfil?.discordGlobalName?.trim()) return perfil.discordGlobalName.trim();
    if (perfil?.discordUsername?.trim()) return perfil.discordUsername.trim();
    return 'Sem nome';
  }, [editandoPerfil, nomeSocialEditavel, perfil?.discordGlobalName, perfil?.discordUsername, perfil?.nomeSocial]);

  const handleExibicaoAtual = useMemo(() => {
    const origem = editandoPerfil ? handleEditavel : perfil?.handle ?? '';
    return normalizarHandle(origem) ?? 'sem_handle';
  }, [editandoPerfil, handleEditavel, perfil?.handle]);

  const uuidAvatarMinecraft = useMemo(() => {
    if (!perfil) return null;

    const contaAtivaUuid = normalizarUuid(usuarioMinecraft?.uuid);
    if (
      contaAtivaUuid &&
      perfil.contasMinecraftVinculadas.some((conta) => normalizarUuid(conta.uuid) === contaAtivaUuid)
    ) {
      return contaAtivaUuid;
    }

    const contaPrincipalUuid = normalizarUuid(perfil.contaMinecraftPrincipalUuid);
    if (contaPrincipalUuid) {
      return contaPrincipalUuid;
    }

    return normalizarUuid(perfil.contasMinecraftVinculadas[0]?.uuid);
  }, [perfil, usuarioMinecraft?.uuid]);

  const amigoSelecionado = useMemo(
    () => (amigoSelecionadoPerfilId ? amigos.find((a) => a.friendProfileId === amigoSelecionadoPerfilId) ?? null : null),
    [amigoSelecionadoPerfilId, amigos]
  );

  const amigosFiltrados = useMemo(() => {
    const filtro = filtroAmigos.trim().toLowerCase();
    if (!filtro) return amigos;
    return amigos.filter((amigo) => {
      const nome = amigo.nome.toLowerCase();
      const handle = (amigo.handle ?? '').toLowerCase();
      return nome.includes(filtro) || handle.includes(filtro);
    });
  }, [amigos, filtroAmigos]);

  const chaveStorageNaoLidas = useMemo(
    () => (perfil?.perfilId ? chaveNaoLidasSocial(perfil.perfilId) : null),
    [perfil?.perfilId]
  );

  const atualizarSessao = useCallback((novaSessao: SessaoSocial | null) => {
    setSessao(novaSessao);
    setPerfil(novaSessao?.perfil ?? null);
    salvarSessaoLocal(novaSessao);
    if (novaSessao?.perfil) {
      setStatusManual(novaSessao.perfil.status === 'ausente' ? 'ausente' : 'online');
      setAparecerOffline(Boolean(novaSessao.perfil.aparecerOffline));
    }
  }, []);

  const obterTokenValido = useCallback(async (): Promise<string | null> => {
    if (!sessao) return null;

    if (!expirada(sessao.expiraEm)) {
      return sessao.accessToken;
    }

    try {
      const resposta = await invoke<RespostaSessaoRefresh>('refresh_launcher_social_session', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        refreshToken: sessao.refreshToken,
      });

      const atualizada: SessaoSocial = {
        ...sessao,
        accessToken: resposta.accessToken,
        expiraEm: resposta.expiraEm,
      };

      atualizarSessao(atualizada);
      return atualizada.accessToken;
    } catch {
      atualizarSessao(null);
      return null;
    }
  }, [atualizarSessao, sessao]);

  const carregarPerfilSocial = useCallback(async (token: string) => {
    setCarregandoPerfil(true);
    setErroPerfil(null);
    try {
      const perfilCarregado = await invoke<PerfilSocial>('get_launcher_social_profile', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
      });
      setPerfil(perfilCarregado);
      setStatusManual(perfilCarregado.status === 'ausente' ? 'ausente' : 'online');
      setAparecerOffline(Boolean(perfilCarregado.aparecerOffline));
      setNomeSocialEditavel(perfilCarregado.nomeSocial ?? '');
      setHandleEditavel(perfilCarregado.handle ?? '');

      setSessao((anterior) => {
        if (!anterior) return anterior;
        const proxima = { ...anterior, perfil: perfilCarregado };
        salvarSessaoLocal(proxima);
        return proxima;
      });
    } catch (erro) {
      setErroPerfil(mensagemErro(erro, 'Nao foi possivel carregar perfil social.'));
    } finally {
      setCarregandoPerfil(false);
    }
  }, []);

  const carregarAmigos = useCallback(async (token: string) => {
    setCarregandoAmigos(true);
    setErroAmigos(null);
    try {
      const dados = await invoke<RespostaAmigosApi>('get_launcher_friends', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
      });

      setAmigos(dados.amigos ?? []);
      setPendentesRecebidas(dados.pendentesRecebidas ?? []);
      setPendentesEnviadas(dados.pendentesEnviadas ?? []);
      setNaoLidasPorAmigo((anterior) => {
        const permitidos = new Set((dados.amigos ?? []).map((item) => item.friendProfileId));
        const proximo: Record<string, number> = {};
        for (const [perfilId, qtd] of Object.entries(anterior)) {
          if (permitidos.has(perfilId) && qtd > 0) {
            proximo[perfilId] = qtd;
          }
        }
        return proximo;
      });
    } catch (erro) {
      setErroAmigos(mensagemErro(erro, 'Nao foi possivel carregar amigos.'));
    } finally {
      setCarregandoAmigos(false);
    }
  }, []);

  const carregarChat = useCallback(async () => {
    const token = await obterTokenValido();
    if (!token || !amigoSelecionadoPerfilId) return;

    setCarregandoChat(true);
    setErroChat(null);
    try {
      const dados = await invoke<RespostaChatApi>('get_launcher_chat_messages', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        friendProfileId: amigoSelecionadoPerfilId,
        limite: 80,
      });

      setMensagensChat(dados.mensagens ?? []);
      setNaoLidasPorAmigo((anterior) => ({ ...anterior, [amigoSelecionadoPerfilId]: 0 }));
    } catch (erro) {
      setErroChat(mensagemErro(erro, 'Nao foi possivel carregar o chat.'));
    } finally {
      setCarregandoChat(false);
    }
  }, [amigoSelecionadoPerfilId, obterTokenValido]);

  const atualizarStatusSocial = useCallback(async (proximoStatus: 'online' | 'ausente', invisivel: boolean) => {
    const token = await obterTokenValido();
    if (!token) return;

    setSalvandoStatus(true);
    try {
      const resposta = await invoke<RespostaStatusSocialApi>('set_launcher_social_status', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: {
          statusManual: proximoStatus,
          aparecerOffline: invisivel,
        },
      });

      if (resposta.perfil) {
        setPerfil(resposta.perfil);
        setStatusManual(resposta.perfil.status === 'ausente' ? 'ausente' : 'online');
        setAparecerOffline(Boolean(resposta.perfil.aparecerOffline));
      }
    } catch (erro) {
      setMensagemPerfil(mensagemErro(erro, 'Nao foi possivel atualizar status social.'));
    } finally {
      setSalvandoStatus(false);
    }
  }, [obterTokenValido]);

  const fluxoUploadSync = useCallback(async (evento: EventoSocketSyncStatus) => {
    const pedidoId = evento.pedidoId?.trim();
    const tokenUpload = evento.tokenUpload?.trim();
    if (!pedidoId || !tokenUpload) return;

    const token = await obterTokenValido();
    if (!token) return;

    const pedido = pedidosSyncRecebidosRef.current.get(pedidoId);
    const instanciaId = pedido?.instanciaId?.trim();
    if (!instanciaId) {
      setMensagemSync('Sync sem instanciaId para upload.');
      return;
    }

    try {
      const pacote = await invoke<ResultadoExportacaoSyncSocial>('export_launcher_social_sync_package', {
        instanceId: instanciaId,
      });
      await invoke('upload_launcher_social_sync_package', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: {
          pedidoId,
          tokenUpload,
          caminhoArquivo: pacote.caminhoArquivo,
        },
      });
      setMensagemSync('Pacote de sync enviado com sucesso.');
    } catch (erro) {
      setMensagemSync(mensagemErro(erro, 'Falha no upload do sync social.'));
    }
  }, [obterTokenValido]);

  const fluxoDownloadSync = useCallback(async (evento: EventoSocketSyncStatus) => {
    const pedidoId = evento.pedidoId?.trim();
    const tokenDownload = evento.tokenDownload?.trim();
    if (!pedidoId || !tokenDownload) return;

    try {
      await invoke('download_import_launcher_social_sync_package', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        pedidoId,
        tokenDownload,
      });
      setMensagemSync('Instancia importada via sync social.');
    } catch (erro) {
      setMensagemSync(mensagemErro(erro, 'Falha ao baixar/importar sync social.'));
    }
  }, []);

  const conectarSocketRealtime = useCallback(async () => {
    const token = await obterTokenValido();
    if (!token) return;

    if (ultimoTokenSocketRef.current === token && socketRef.current?.connected) {
      return;
    }

    socketRef.current?.disconnect();
    const socket = io(API_DOME_LAUNCHER_URL, {
      auth: { accessToken: token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      ultimoTokenSocketRef.current = token;
      socket.emit('social:presenca:heartbeat', atividadeLocal);
    });

    socket.on('social:amigos:atualizar', async () => {
      const tokenAtual = await obterTokenValido();
      if (!tokenAtual) return;
      await carregarAmigos(tokenAtual);
    });

    socket.on('social:chat:nova', (evento: { mensagem?: MensagemChatApi }) => {
      const mensagem = evento?.mensagem;
      if (!mensagem) return;

      const meuPerfilId = perfil?.perfilId;
      const outroPerfilId = meuPerfilId === mensagem.dePerfilId ? mensagem.paraPerfilId : mensagem.dePerfilId;

      setMensagensChat((anterior) => {
        if (anterior.some((item) => item.id === mensagem.id)) return anterior;
        if (!amigoSelecionadoPerfilId || outroPerfilId !== amigoSelecionadoPerfilId) return anterior;
        return [...anterior, mensagem];
      });

      if (!amigoSelecionadoPerfilId || outroPerfilId !== amigoSelecionadoPerfilId) {
        setNaoLidasPorAmigo((anterior) => ({
          ...anterior,
          [outroPerfilId]: (anterior[outroPerfilId] ?? 0) + 1,
        }));
      }
    });

    socket.on('social:sync:pedido', (evento: EventoSocketSyncPedido) => {
      const pedidoId = evento.pedidoId?.trim();
      if (!pedidoId) return;
      pedidosSyncRecebidosRef.current.set(pedidoId, evento);

      const amigo = amigos.find((item) => item.friendProfileId === evento.solicitantePerfilId);
      const nomeAmigo = amigo?.nome ?? 'Seu amigo';
      const aceitou = window.confirm(
        `${nomeAmigo} pediu sync da instancia "${evento.instanciaNome || evento.instanciaId || 'desconhecida'}". Aceitar?`
      );

      socket.emit('social:sync:responder', { pedidoId, aceitar: aceitou });
    });

    socket.on('social:sync:status', async (evento: EventoSocketSyncStatus) => {
      if (evento.status === 'aguardando_upload' && evento.tokenUpload) {
        await fluxoUploadSync(evento);
        return;
      }
      if (evento.status === 'pronto_download' && evento.tokenDownload) {
        await fluxoDownloadSync(evento);
      }
    });

    socketRef.current = socket;
  }, [atividadeLocal, amigoSelecionadoPerfilId, amigos, carregarAmigos, fluxoDownloadSync, fluxoUploadSync, obterTokenValido, perfil?.perfilId]);

  useEffect(() => {
    const sessaoLocal = lerSessaoLocal();
    atualizarSessao(sessaoLocal);
    setCarregandoSessao(false);
  }, [atualizarSessao]);

  useEffect(() => {
    if (!chaveStorageNaoLidas) {
      setNaoLidasPorAmigo({});
      return;
    }

    try {
      const bruto = localStorage.getItem(chaveStorageNaoLidas);
      if (!bruto) {
        setNaoLidasPorAmigo({});
        return;
      }

      const json = JSON.parse(bruto) as Record<string, unknown>;
      const normalizado: Record<string, number> = {};
      for (const [perfilId, valor] of Object.entries(json)) {
        const qtd = Number(valor);
        if (Number.isFinite(qtd) && qtd > 0) {
          normalizado[perfilId] = Math.floor(qtd);
        }
      }
      setNaoLidasPorAmigo(normalizado);
    } catch {
      setNaoLidasPorAmigo({});
    }
  }, [chaveStorageNaoLidas]);

  useEffect(() => {
    if (!chaveStorageNaoLidas) return;
    localStorage.setItem(chaveStorageNaoLidas, JSON.stringify(naoLidasPorAmigo));
  }, [chaveStorageNaoLidas, naoLidasPorAmigo]);

  useEffect(() => {
    const aoAtualizarAtividade = (evento: Event) => {
      const detalhe = (evento as CustomEvent<AtividadeLocalLauncher>).detail;
      if (!detalhe) return;
      setAtividadeLocal({
        emJogo: Boolean(detalhe.emJogo),
        atividadeAtual: detalhe.atividadeAtual ?? null,
      });
    };

    window.addEventListener('dome:social-atividade-atualizada', aoAtualizarAtividade);
    return () => {
      window.removeEventListener('dome:social-atividade-atualizada', aoAtualizarAtividade);
    };
  }, []);

  useEffect(() => {
    if (!sessao) return;

    let ativo = true;

    const carregar = async () => {
      let token = sessao.accessToken;

      if (expirada(sessao.expiraEm)) {
        try {
          const resposta = await invoke<RespostaSessaoRefresh>('refresh_launcher_social_session', {
            apiBaseUrl: API_DOME_LAUNCHER_URL,
            refreshToken: sessao.refreshToken,
          });

          const atualizada: SessaoSocial = {
            ...sessao,
            accessToken: resposta.accessToken,
            expiraEm: resposta.expiraEm,
          };

          atualizarSessao(atualizada);
          token = atualizada.accessToken;
        } catch {
          atualizarSessao(null);
          return;
        }
      }

      if (!ativo || !token) return;
      await Promise.all([carregarPerfilSocial(token), carregarAmigos(token)]);
      await conectarSocketRealtime();
    };

    carregar();
    return () => {
      ativo = false;
    };
  }, [atualizarSessao, carregarAmigos, carregarPerfilSocial, conectarSocketRealtime, sessao?.accessToken, sessao?.expiraEm, sessao?.refreshToken]);

  useEffect(() => {
    if (!amigos.length) {
      setAmigoSelecionadoPerfilId(null);
      return;
    }

    if (!amigoSelecionadoPerfilId || !amigos.some((a) => a.friendProfileId === amigoSelecionadoPerfilId)) {
      setAmigoSelecionadoPerfilId(amigos[0].friendProfileId);
    }
  }, [amigoSelecionadoPerfilId, amigos]);

  useEffect(() => {
    carregarChat();
  }, [carregarChat]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit('social:presenca:heartbeat', atividadeLocal);
    const intervalo = window.setInterval(() => {
      socket.emit('social:presenca:heartbeat', atividadeLocal);
    }, INTERVALO_HEARTBEAT_MS);

    return () => {
      window.clearInterval(intervalo);
    };
  }, [atividadeLocal]);

  useEffect(() => {
    if (!amigoSelecionadoPerfilId) return;
    setNaoLidasPorAmigo((anterior) => ({ ...anterior, [amigoSelecionadoPerfilId]: 0 }));
  }, [amigoSelecionadoPerfilId]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      ultimoTokenSocketRef.current = '';
    };
  }, []);

  useEffect(() => {
    if (!sessao || !perfil || !usuarioMinecraft) return;

    const uuidAtual = normalizarUuid(usuarioMinecraft.uuid);
    if (!uuidAtual) return;

    const jaVinculada = perfil.contasMinecraftVinculadas.some((conta) => normalizarUuid(conta.uuid) === uuidAtual);

    let ativo = true;

    const sincronizarContaPrincipal = async (token: string) => {
      if (normalizarUuid(perfil.contaMinecraftPrincipalUuid) === uuidAtual) return;

      try {
        const dados = await invoke<RespostaSalvarPerfilApi>('save_launcher_social_profile', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: token,
          payload: {
            contaMinecraftPrincipalUuid: uuidAtual,
          },
        });

        if (!ativo || !dados?.perfil) return;
        setPerfil(dados.perfil);
        setSessao((anterior) => {
          if (!anterior) return anterior;
          const proxima = { ...anterior, perfil: dados.perfil! };
          salvarSessaoLocal(proxima);
          return proxima;
        });
      } catch {
        // Falha silenciosa para nao atrapalhar o social.
      }
    };

    const sincronizarVinculoDaContaAtiva = async () => {
      const token = await obterTokenValido();
      if (!token || !ativo) return;

      if (jaVinculada) {
        await sincronizarContaPrincipal(token);
        return;
      }

      try {
        const dados = await invoke<RespostaSalvarPerfilApi>('link_launcher_minecraft_account', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: token,
          payload: {
            uuid: usuarioMinecraft.uuid,
            nome: usuarioMinecraft.name,
            minecraftAccessToken: usuarioMinecraft.access_token,
          },
        });

        if (!ativo || !dados?.perfil) return;
        setPerfil(dados.perfil);
        setSessao((anterior) => {
          if (!anterior) return anterior;
          const proxima = { ...anterior, perfil: dados.perfil! };
          salvarSessaoLocal(proxima);
          return proxima;
        });
      } catch {
        // Vinculo automatico silencioso para nao poluir a UI.
      }
    };

    sincronizarVinculoDaContaAtiva();

    return () => {
      ativo = false;
    };
  }, [obterTokenValido, perfil, sessao, usuarioMinecraft]);

  const iniciarLoginDiscord = async () => {
    setMensagemPerfil(null);
    setErroPerfil(null);

    if (!API_DOME_LAUNCHER_URL || !DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
      setErroPerfil('Não foi possível iniciar login social. Verifique sua conexão e tente novamente.');
      return;
    }

    try {
      const novaSessao = await invoke<SessaoSocial>('login_discord_social', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        clientId: DISCORD_CLIENT_ID,
        redirectUri: DISCORD_REDIRECT_URI,
        scope: DISCORD_SCOPES,
      });

      atualizarSessao(novaSessao);
      setNomeSocialEditavel(novaSessao.perfil.nomeSocial ?? '');
      setHandleEditavel(novaSessao.perfil.handle ?? '');
      setMensagemPerfil('Sessao social conectada com sucesso.');
      await carregarAmigos(novaSessao.accessToken);
      await conectarSocketRealtime();
    } catch (erro) {
      setErroPerfil(mensagemErro(erro, 'Nao foi possivel autenticar com Discord.'));
    }
  };

  const salvarPerfilSocial = async () => {
    const token = await obterTokenValido();
    if (!token) return;

    const handleNormalizado = normalizarHandle(handleEditavel);
    if (handleEditavel.trim() && !handleNormalizado) {
      setErroPerfil('Handle invalido. Use 3-24 caracteres: letras, numeros, ponto e _.');
      return;
    }

    setSalvandoPerfil(true);
    setErroPerfil(null);
    setMensagemPerfil(null);

    try {
      const dados = await invoke<RespostaSalvarPerfilApi>('save_launcher_social_profile', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: {
          nomeSocial: nomeSocialEditavel.trim() || undefined,
          handle: handleNormalizado ?? undefined,
          contaMinecraftPrincipalUuid: perfil?.contaMinecraftPrincipalUuid ?? undefined,
        },
      });

      if (dados?.perfil) {
        setPerfil(dados.perfil);
        setNomeSocialEditavel(dados.perfil.nomeSocial ?? '');
        setHandleEditavel(dados.perfil.handle ?? '');
        setSessao((anterior) => {
          if (!anterior) return anterior;
          const proxima = { ...anterior, perfil: dados.perfil! };
          salvarSessaoLocal(proxima);
          return proxima;
        });
      }

      setMensagemPerfil('Perfil social atualizado.');
      setEditandoPerfil(false);
    } catch (erro) {
      const msg = mensagemErro(erro, 'Nao foi possivel salvar o perfil social.');
      setErroPerfil(msg.toLowerCase().includes('handle ja esta em uso') ? 'Handle ja esta em uso. Escolha outro.' : msg);
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const enviarSolicitacaoPorHandle = async () => {
    const token = await obterTokenValido();
    if (!token) return;

    const handleNormalizado = normalizarHandle(handleNovoAmigo);
    if (!handleNormalizado) {
      setMensagemSolicitacao('Handle invalido.');
      return;
    }

    setEnviandoSolicitacao(true);
    setMensagemSolicitacao(null);

    try {
      await invoke('send_launcher_friend_request_by_handle', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: { handle: handleNormalizado },
      });

      setHandleNovoAmigo('');
      setMensagemSolicitacao('Solicitacao enviada.');
      await carregarAmigos(token);
    } catch (erro) {
      setMensagemSolicitacao(mensagemErro(erro, 'Falha ao enviar solicitacao.'));
    } finally {
      setEnviandoSolicitacao(false);
    }
  };

  const responderSolicitacao = async (requestId: string, acao: 'accept' | 'reject') => {
    const token = await obterTokenValido();
    if (!token) return;

    try {
      await invoke('respond_launcher_friend_request', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        requestId,
        acao,
      });

      await carregarAmigos(token);
      if (acao === 'accept') {
        setMensagemSolicitacao('Solicitacao aceita.');
      }
    } catch (erro) {
      setMensagemSolicitacao(mensagemErro(erro, 'Falha ao responder solicitacao.'));
    }
  };

  const cancelarSolicitacaoEnviada = async (requestId: string) => {
    const token = await obterTokenValido();
    if (!token) return;

    try {
      await invoke('cancel_launcher_friend_request', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        requestId,
      });

      await carregarAmigos(token);
      setMensagemSolicitacao('Solicitacao cancelada.');
    } catch (erro) {
      setMensagemSolicitacao(mensagemErro(erro, 'Falha ao cancelar solicitacao.'));
    }
  };

  const removerAmigo = async (friendProfileId: string) => {
    const token = await obterTokenValido();
    if (!token) return;

    try {
      await invoke('remove_launcher_friend', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        friendProfileId,
      });
      await carregarAmigos(token);
    } catch (erro) {
      setErroAmigos(mensagemErro(erro, 'Nao foi possivel remover amizade.'));
    }
  };

  const solicitarSyncInstancia = async (friendProfileId: string, atividade?: AtividadeSocial | null) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setMensagemSync('Realtime indisponivel para solicitar sync agora.');
      return;
    }

    await new Promise<void>((resolve) => {
      socket.emit(
        'social:sync:solicitar',
        {
          alvoPerfilId: friendProfileId,
          instanciaId: atividade?.instanciaId ?? null,
          instanciaNome: atividade?.instanciaNome ?? null,
        },
        (resposta: { sucesso?: boolean; pedidoId?: string; erro?: string }) => {
          if (!resposta?.sucesso) {
            setMensagemSync(resposta?.erro || 'Falha ao solicitar sync.');
          } else {
            setMensagemSync(`Pedido de sync enviado (ID ${resposta.pedidoId}).`);
          }
          resolve();
        }
      );
    });
  };

  const abrirModalAtividade = (amigo: AmigoSocial) => {
    if (!amigo.atividadeAtual) {
      setMensagemSync('Este amigo nao tem atividade ativa no momento.');
      return;
    }
    setAmigoModalAtividade(amigo);
  };

  const instalarMesmaInstanciaPorAtividade = async (
    friendProfileId: string,
    atividade?: AtividadeSocial | null
  ) => {
    if (!atividade) {
      setMensagemSync('Sem atividade valida para instalar.');
      return;
    }

    // Para CurseForge, o fluxo padrão é sync completo da atividade.
    if (atividade.source === 'curseforge') {
      await solicitarSyncInstancia(friendProfileId, atividade);
      setMensagemSync('Atividade CurseForge detectada. Pedido de sync enviado.');
      return;
    }

    if (!atividade.projectId || !atividade.versionId || atividade.source !== 'modrinth') {
      setMensagemSync('Metadado exato indisponivel. Use o fluxo de sync para clonar a instancia.');
      return;
    }

    try {
      setMensagemSync('Preparando instalacao exata do modpack...');
      const resposta = await fetch(`https://api.modrinth.com/v2/version/${atividade.versionId}`);
      if (!resposta.ok) {
        throw new Error(`Falha ao buscar versao exata (HTTP ${resposta.status}).`);
      }

      const versao = (await resposta.json()) as VersaoModrinth;
      const arquivo =
        versao.files.find((item) => item.primary) ||
        versao.files.find((item) => item.filename.toLowerCase().endsWith('.mrpack')) ||
        versao.files[0];
      if (!arquivo?.url) {
        throw new Error('Arquivo da versao exata nao encontrado.');
      }

      const versaoMinecraft = atividade.versaoMinecraft || escolherVersaoMinecraftIdeal(versao.game_versions || []);
      if (!versaoMinecraft) {
        throw new Error('Nao foi possivel determinar versao Minecraft exata.');
      }

      const loaderCandidato = (atividade.loader || versao.loaders?.[0] || 'vanilla').toLowerCase();
      const loaderNormalizado =
        loaderCandidato === 'fabric' || loaderCandidato === 'forge' || loaderCandidato === 'neoforge'
          ? loaderCandidato
          : 'vanilla';

      const instancias = await invoke<InstanciaResumo[]>('get_instances');
      const nomeBase = atividade.modpackNome || atividade.instanciaNome || 'Instancia social';
      const nomeInstancia = gerarNomeInstanciaDisponivel(
        `${nomeBase} (social)`,
        (instancias ?? []).map((item) => item.name)
      );
      const idInstancia = gerarIdInstancia(nomeInstancia);

      let loaderVersion: string | undefined;
      if (loaderNormalizado !== 'vanilla') {
        const respostaLoader = await invoke<LoaderVersionsResponse>('get_loader_versions', {
          loaderType: loaderNormalizado,
        });
        loaderVersion =
          escolherVersaoLoaderIdeal(loaderNormalizado, respostaLoader.versions || [], versaoMinecraft) || undefined;
        if (!loaderVersion) {
          throw new Error(`Nenhuma versao valida do loader ${loaderNormalizado} encontrada.`);
        }
      }

      const paramsCriacao: Record<string, unknown> = {
        name: nomeInstancia,
        version: versaoMinecraft,
        mcType: loaderNormalizado,
      };
      if (loaderNormalizado !== 'vanilla') {
        paramsCriacao.loaderType = loaderNormalizado;
        paramsCriacao.loaderVersion = loaderVersion;
      }

      await invoke('create_instance', paramsCriacao);
      await invoke('save_modpack_info', {
        instanceId: idInstancia,
        modpackInfo: {
          projectId: atividade.projectId,
          versionId: atividade.versionId,
          fileId: atividade.fileId || null,
          name: nomeBase,
          author: 'Social',
          icon: null,
          slug: atividade.projectId,
          source: atividade.source,
          installedVersion: versao.version_number,
        },
      });
      await invoke('install_modpack_files', {
        instanceId: idInstancia,
        downloadUrl: arquivo.url,
        fileName: arquivo.filename || `${idInstancia}.mrpack`,
      });

      setMensagemSync('Modpack exato instalado com sucesso.');
      window.location.reload();
    } catch (erro) {
      setMensagemSync(mensagemErro(erro, 'Falha ao instalar mesma instancia.'));
    }
  };

  const enviarMensagemChat = async () => {
    const token = await obterTokenValido();
    if (!token || !amigoSelecionadoPerfilId || !textoChat.trim()) return;

    setEnviandoChat(true);
    setErroChat(null);
    try {
      const mensagem = await invoke<MensagemChatApi>('send_launcher_chat_message', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: { paraPerfilId: amigoSelecionadoPerfilId, conteudo: textoChat.trim() },
      });

      setTextoChat('');
      setMensagensChat((anterior) => [...anterior, mensagem]);
    } catch (erro) {
      setErroChat(mensagemErro(erro, 'Nao foi possivel enviar mensagem.'));
    } finally {
      setEnviandoChat(false);
    }
  };

  const aoPressionarEnterMensagem = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key !== 'Enter' || evento.shiftKey) return;
    evento.preventDefault();
    enviarMensagemChat();
  };

  if (carregandoSessao) {
    return (
      <aside className={cn('launcher-social w-[311px] shrink-0 overflow-y-auto scrollbar-hide', className)}>
        <div className="flex w-full items-center justify-center text-xs text-white/60">
          <Loader2 size={12} className="animate-spin" />
          <span className="ml-2">Carregando social...</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className={cn('launcher-social w-[311px] shrink-0 overflow-y-auto scrollbar-hide', className)}>
      <div className="flex w-full flex-col gap-4">
        <div className="border border-white/10 bg-[#151515] p-[13px]">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-wide text-white/75">Social</p>
            {onFecharDrawer && (
              <button
                onClick={onFecharDrawer}
                className="border border-white/15 bg-[#121212] px-1 py-0.5 text-[10px] text-white/70 hover:text-white xl:hidden"
              >
                Fechar
              </button>
            )}
          </div>

          {!sessao && (
            <div className="space-y-2">
              <p className="font-['MinecraftSeven','Sora',sans-serif] text-[12px] text-white/55">
                Logue com Discord para liberar o social e configurar seu perfil.
              </p>
              <button
                onClick={iniciarLoginDiscord}
                className="w-full border border-white/20 bg-[#00498e] px-[9px] pb-[9.33px] pt-2 font-['MinecraftSeven','Sora',sans-serif] text-[13px] uppercase tracking-[0.325px] text-white hover:border-white/35"
              >
                Entrar com Discord
              </button>
              {erroPerfil && <p className="text-[11px] text-red-300/90">{erroPerfil}</p>}
              {!erroPerfil && mensagemPerfil && <p className="text-[11px] text-emerald-300/90">{mensagemPerfil}</p>}
            </div>
          )}

          {sessao && perfil && (
            <div className="space-y-2">
              <div className="group flex items-center gap-2 px-1">
                {uuidAvatarMinecraft ? (
                  <img
                    src={`https://mc-heads.net/head/${uuidAvatarMinecraft}/64`}
                    alt={nomeExibicaoAtual}
                    className="h-8 w-8 border border-white/15 bg-[#202020] object-cover"
                  />
                ) : perfil.discordAvatar ? (
                  <img
                    src={`https://cdn.discordapp.com/avatars/${perfil.discordId}/${perfil.discordAvatar}.png?size=64`}
                    alt={nomeExibicaoAtual}
                    className="h-8 w-8 rounded-full border border-white/15"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full border border-white/15 bg-[#202020]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-white">{nomeExibicaoAtual}</p>
                  <p className="truncate text-[10px] text-white/55">@{handleExibicaoAtual}</p>
                  <p className={cn('text-[10px] font-bold', classeStatus(perfil.status))}>
                    {rotuloStatus(perfil.status)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setMensagemPerfil(null);
                    setErroPerfil(null);
                    setNomeSocialEditavel(perfil.nomeSocial ?? '');
                    setHandleEditavel(perfil.handle ?? '');
                    setEditandoPerfil(true);
                  }}
                  disabled={carregandoPerfil}
                  aria-label="Editar perfil social"
                  className={cn(
                    'opacity-0 transition-opacity group-hover:opacity-100',
                    carregandoPerfil ? 'cursor-not-allowed text-white/25' : 'text-white/60 hover:text-white'
                  )}
                >
                  <Pencil size={12} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 px-1">
                <button
                  onClick={() => atualizarStatusSocial('online', aparecerOffline)}
                  disabled={salvandoStatus}
                  className={cn(
                    'border px-2 py-1 text-[10px] font-bold uppercase tracking-wide',
                    statusManual === 'online'
                      ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200'
                      : 'border-white/15 bg-[#161616] text-white/75'
                  )}
                >
                  Online
                </button>
                <button
                  onClick={() => atualizarStatusSocial('ausente', aparecerOffline)}
                  disabled={salvandoStatus}
                  className={cn(
                    'border px-2 py-1 text-[10px] font-bold uppercase tracking-wide',
                    statusManual === 'ausente'
                      ? 'border-amber-400/45 bg-amber-500/15 text-amber-200'
                      : 'border-white/15 bg-[#161616] text-white/75'
                  )}
                >
                  Ausente
                </button>
                <button
                  onClick={() => {
                    const proximo = !aparecerOffline;
                    setAparecerOffline(proximo);
                    atualizarStatusSocial(statusManual, proximo);
                  }}
                  disabled={salvandoStatus}
                  className={cn(
                    'col-span-2 border px-2 py-1 text-[10px] font-bold uppercase tracking-wide',
                    aparecerOffline
                      ? 'border-red-400/45 bg-red-500/15 text-red-200'
                      : 'border-white/15 bg-[#161616] text-white/75'
                  )}
                >
                  {aparecerOffline ? 'Invisivel (parece offline)' : 'Visivel para amigos'}
                </button>
              </div>

              {editandoPerfil && (
                <div className="space-y-2 px-1">
                  <input
                    value={nomeSocialEditavel}
                    onChange={(e) => setNomeSocialEditavel(e.target.value)}
                    placeholder="Nome social"
                    className="w-full border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45"
                  />
                  <input
                    value={handleEditavel}
                    onChange={(e) => setHandleEditavel(e.target.value)}
                    placeholder="handle (sem @)"
                    className="w-full border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditandoPerfil(false)}
                      disabled={salvandoPerfil}
                      className="flex-1 border border-white/15 bg-[#161616] px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/80 hover:text-white disabled:cursor-not-allowed disabled:text-white/40"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={salvarPerfilSocial}
                      disabled={salvandoPerfil || carregandoPerfil}
                      className="flex-1 border border-white/20 bg-[#202020] px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/85 hover:border-white/40 disabled:cursor-not-allowed disabled:text-white/40"
                    >
                      {salvandoPerfil ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </div>
              )}

              {erroPerfil && <p className="px-1 text-[11px] text-red-300/90">{erroPerfil}</p>}
              {!erroPerfil && mensagemPerfil && <p className="px-1 text-[11px] text-emerald-300/90">{mensagemPerfil}</p>}
            </div>
          )}
        </div>

        <div className="border border-white/10 bg-[#151515] p-[13px]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users size={13} className="text-white/55" />
              <p className="text-xs font-black uppercase tracking-wide text-white/75">Amigos</p>
            </div>
            {pendentesRecebidas.length > 0 && (
              <span className="inline-flex items-center border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                {pendentesRecebidas.length} pendente{pendentesRecebidas.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {sessao && (
            <div className="mb-3 space-y-2">
              <input
                value={filtroAmigos}
                onChange={(e) => setFiltroAmigos(e.target.value)}
                placeholder="Filtrar lista de amigos..."
                className="w-full border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45"
              />
              <div className="flex gap-2">
                <input
                  value={handleNovoAmigo}
                  onChange={(e) => setHandleNovoAmigo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && enviarSolicitacaoPorHandle()}
                  placeholder="Adicionar por handle..."
                  className="min-w-0 flex-1 border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45"
                />
                <button
                  onClick={enviarSolicitacaoPorHandle}
                  disabled={enviandoSolicitacao}
                  className={cn(
                    'border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                    enviandoSolicitacao
                      ? 'cursor-not-allowed border-white/10 bg-[#151515] text-white/40'
                      : 'border-white/20 bg-[#202020] text-white/85 hover:border-white/40'
                  )}
                >
                  {enviandoSolicitacao ? '...' : 'Adicionar'}
                </button>
              </div>

              {pendentesRecebidas.length > 0 && (
                <div className="space-y-1 border border-white/10 bg-[#101010] p-2">
                  <p className="text-[10px] font-black uppercase tracking-wide text-white/70">Solicitacoes recebidas</p>
                  {pendentesRecebidas.map((pendente) => (
                    <div key={pendente.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <p className="truncate text-white/85">{pendente.deNome} {pendente.deHandle ? `@${pendente.deHandle}` : ''}</p>
                      <div className="flex gap-1">
                        <button onClick={() => responderSolicitacao(pendente.id, 'accept')} className="border border-emerald-400/35 bg-emerald-500/10 px-1.5 py-1 text-emerald-200">Aceitar</button>
                        <button onClick={() => responderSolicitacao(pendente.id, 'reject')} className="border border-red-400/35 bg-red-500/10 px-1.5 py-1 text-red-200">Recusar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pendentesEnviadas.length > 0 && (
                <div className="space-y-1 border border-white/10 bg-[#101010] p-2">
                  <p className="text-[10px] font-black uppercase tracking-wide text-white/70">Solicitacoes enviadas</p>
                  {pendentesEnviadas.map((pendente) => (
                    <div key={pendente.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <p className="truncate text-white/65">{pendente.paraNome} {pendente.paraHandle ? `@${pendente.paraHandle}` : ''} ({tempoRelativo(pendente.criadoEm)})</p>
                      <button
                        onClick={() => cancelarSolicitacaoEnviada(pendente.id)}
                        className="border border-red-400/35 bg-red-500/10 px-1.5 py-1 text-red-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {mensagemSolicitacao && <p className="text-[11px] text-white/65">{mensagemSolicitacao}</p>}
              {mensagemSync && <p className="text-[11px] text-emerald-200/90">{mensagemSync}</p>}
            </div>
          )}

          {!sessao && <p className="py-4 text-center text-xs text-white/45">Faça login com Discord para ver e adicionar amigos.</p>}
          {sessao && carregandoAmigos && <div className="flex items-center justify-center gap-2 py-4 text-xs text-white/60"><Loader2 size={12} className="animate-spin" />Carregando amigos...</div>}
          {sessao && !carregandoAmigos && erroAmigos && <p className="py-4 text-center text-xs text-red-300/85">{erroAmigos}</p>}
          {sessao && !carregandoAmigos && !erroAmigos && amigosFiltrados.length === 0 && <p className="py-4 text-center text-xs text-white/45">Nenhum amigo encontrado.</p>}

          {sessao && !carregandoAmigos && !erroAmigos && amigosFiltrados.length > 0 && (
            <div className="space-y-2">
              {amigosFiltrados.slice(0, 30).map((amigo) => (
                <div
                  key={amigo.friendProfileId}
                  className={cn(
                    'w-full flex items-center gap-2 border px-2 py-1.5',
                    amigoSelecionadoPerfilId === amigo.friendProfileId ? 'border-emerald-400/35 bg-emerald-500/10' : 'border-white/10 bg-[#101010]'
                  )}
                >
                  <button
                    onClick={() => setAmigoSelecionadoPerfilId(amigo.friendProfileId)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <div className={cn(
                      'h-7 w-7 border border-white/15',
                      amigo.status === 'online'
                        ? 'bg-emerald-500/30'
                        : amigo.status === 'ausente'
                          ? 'bg-amber-500/35'
                          : 'bg-[#222]'
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white/90">{amigo.nome}</p>
                      <p className={cn('truncate text-[10px]', classeStatus(amigo.status))}>
                        {amigo.status === 'offline'
                          ? `Visto ${tempoRelativo(amigo.ultimoSeenEm)}`
                          : `${rotuloStatus(amigo.status)}${amigo.handle ? ` · @${amigo.handle}` : ''}`}
                      </p>
                      {amigo.atividadeAtual?.modpackNome && (
                        <p className="truncate text-[10px] text-cyan-300/90">Jogando: {amigo.atividadeAtual.modpackNome}</p>
                      )}
                    </div>
                  </button>

                  {amigo.atividadeAtual && (
                    <button
                      onClick={() => abrirModalAtividade(amigo)}
                      className="border border-cyan-400/35 bg-cyan-500/10 px-1.5 py-1 text-[10px] text-cyan-200"
                    >
                      Atividade
                    </button>
                  )}
                  {(naoLidasPorAmigo[amigo.friendProfileId] ?? 0) > 0 && (
                    <span className="inline-flex min-w-[18px] items-center justify-center border border-emerald-400/40 bg-emerald-500/20 px-1 py-0.5 text-[10px] font-bold text-emerald-200">
                      {(naoLidasPorAmigo[amigo.friendProfileId] ?? 0) > 99 ? '99+' : (naoLidasPorAmigo[amigo.friendProfileId] ?? 0)}
                    </span>
                  )}
                </div>
              ))}

              {amigoSelecionado && (
                <div className="border border-white/10 bg-[#111111] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] font-bold text-white/90">Chat com {amigoSelecionado.nome}</p>
                    <div className="flex gap-1">
                      {amigoSelecionado.atividadeAtual && (
                        <button
                          onClick={() => abrirModalAtividade(amigoSelecionado)}
                          className="border border-cyan-400/35 bg-cyan-500/10 px-1.5 py-1 text-[10px] text-cyan-200"
                        >
                          Atividade
                        </button>
                      )}
                      <button
                        onClick={() => removerAmigo(amigoSelecionado.friendProfileId)}
                        className="border border-red-400/35 bg-red-500/10 px-1.5 py-1 text-[10px] text-red-200"
                      >
                        Remover
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1 scrollbar-hide">
                    {carregandoChat && <p className="text-[11px] text-white/45">Carregando conversa...</p>}
                    {!carregandoChat && mensagensChat.length === 0 && <p className="text-[11px] text-white/45">Nenhuma mensagem ainda.</p>}
                    {!carregandoChat && mensagensChat.map((mensagem) => {
                      const ehMinha = mensagem.dePerfilId === perfil?.perfilId;
                      return (
                        <div key={mensagem.id} className={cn('max-w-[85%] border px-2 py-1 text-[11px]', ehMinha ? 'ml-auto border-emerald-400/35 bg-emerald-500/10 text-emerald-100' : 'border-white/15 bg-[#171717] text-white/80')}>
                          <p>{mensagem.conteudo}</p>
                          <p className="mt-1 text-[10px] text-white/45">{tempoRelativo(mensagem.criadoEm)}</p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex gap-2">
                    <input
                      value={textoChat}
                      onChange={(e) => setTextoChat(e.target.value)}
                      onKeyDown={aoPressionarEnterMensagem}
                      placeholder={`Mensagem para ${amigoSelecionado.nome}`}
                      className="min-w-0 flex-1 border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45"
                    />
                    <button
                      onClick={enviarMensagemChat}
                      disabled={enviandoChat || !textoChat.trim()}
                      className={cn(
                        'border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                        enviandoChat || !textoChat.trim()
                          ? 'cursor-not-allowed border-white/10 bg-[#151515] text-white/40'
                          : 'border-white/20 bg-[#202020] text-white/85 hover:border-white/40'
                      )}
                    >
                      {enviandoChat ? '...' : 'Enviar'}
                    </button>
                  </div>

                  {erroChat && <p className="mt-2 text-[11px] text-red-300/85">{erroChat}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {amigoModalAtividade && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={() => {
            if (processandoAtividade) return;
            setAmigoModalAtividade(null);
          }}
        >
          <div
            className="w-full max-w-md border border-white/15 bg-[#121212] p-4"
            onClick={(evento) => evento.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-cyan-200">
                  Atividade de {amigoModalAtividade.nome}
                </p>
                <p className="text-[11px] text-white/65">
                  {amigoModalAtividade.atividadeAtual?.instanciaNome || 'Instancia em andamento'}
                </p>
              </div>
              <button
                onClick={() => setAmigoModalAtividade(null)}
                disabled={processandoAtividade}
                className="border border-white/15 bg-[#181818] p-1 text-white/70 hover:text-white disabled:cursor-not-allowed disabled:text-white/40"
                aria-label="Fechar modal de atividade"
              >
                <X size={12} />
              </button>
            </div>

            <div className="space-y-1 border border-white/10 bg-[#0f0f0f] p-2 text-[11px] text-white/80">
              <p>Fonte: {amigoModalAtividade.atividadeAtual?.source || 'launcher'}</p>
              <p>Modpack: {amigoModalAtividade.atividadeAtual?.modpackNome || 'Nao informado'}</p>
              <p>Versao exata: {amigoModalAtividade.atividadeAtual?.versionId || 'Nao informada'}</p>
              <p>Servidor: {amigoModalAtividade.atividadeAtual?.servidor || 'Nao informado'}</p>
              <p>Atualizado: {tempoRelativo(amigoModalAtividade.atividadeAtual?.atualizadoEm)}</p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  if (!amigoModalAtividade.atividadeAtual) return;
                  setProcessandoAtividade(true);
                  try {
                    await instalarMesmaInstanciaPorAtividade(
                      amigoModalAtividade.friendProfileId,
                      amigoModalAtividade.atividadeAtual
                    );
                    setAmigoModalAtividade(null);
                  } finally {
                    setProcessandoAtividade(false);
                  }
                }}
                disabled={processandoAtividade}
                className={cn(
                  'border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                  processandoAtividade
                    ? 'cursor-not-allowed border-white/10 bg-[#151515] text-white/40'
                    : 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
                )}
              >
                {processandoAtividade
                  ? 'Processando...'
                  : (amigoModalAtividade.atividadeAtual?.source === 'curseforge' ? 'Sync (CF)' : 'Instalar exata')}
              </button>

              <button
                onClick={async () => {
                  if (!amigoModalAtividade.atividadeAtual) return;
                  setProcessandoAtividade(true);
                  try {
                    await solicitarSyncInstancia(
                      amigoModalAtividade.friendProfileId,
                      amigoModalAtividade.atividadeAtual
                    );
                    setAmigoModalAtividade(null);
                  } finally {
                    setProcessandoAtividade(false);
                  }
                }}
                disabled={processandoAtividade}
                className={cn(
                  'border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                  processandoAtividade
                    ? 'cursor-not-allowed border-white/10 bg-[#151515] text-white/40'
                    : 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200'
                )}
              >
                Pedir sync
              </button>
            </div>

            <p className="mt-2 text-[10px] text-white/50">
              Modrinth tenta instalacao exata. CurseForge cai no sync completo automaticamente.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
