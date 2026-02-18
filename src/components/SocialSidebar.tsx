import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Pencil, Users } from '../iconesPixelados';
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

interface SocialSidebarProps {
  usuarioMinecraft: ContaMinecraft | null;
}

const CHAVE_SESSAO_SOCIAL = 'dome:social:sessao:v2';
const URL_API_DOME_LAUNCHER_PADRAO = 'https://api.domestudios.com.br';

const urlApi = (
  (import.meta.env.DOME_API_PUBLIC_URL as string | undefined) ??
  (import.meta.env.DOME_API_URL as string | undefined) ??
  (import.meta.env.VITE_DOME_API_PUBLIC_URL as string | undefined) ??
  (import.meta.env.VITE_DOME_API_URL as string | undefined) ??
  (import.meta.env.VITE_API_PUBLIC_URL as string | undefined)
)
  ?.trim()
  .replace(/\/+$/, '');

const API_DOME_LAUNCHER_URL =
  urlApi && urlApi.length > 0 ? urlApi : URL_API_DOME_LAUNCHER_PADRAO;

const DISCORD_CLIENT_ID = (
  (import.meta.env.DOME_CLIENT_ID as string | undefined) ??
  (import.meta.env.DOME_DISCORD_CLIENT_ID as string | undefined) ??
  (import.meta.env.VITE_DOME_CLIENT_ID as string | undefined) ??
  (import.meta.env.VITE_DOME_DISCORD_CLIENT_ID as string | undefined)
)
  ?.trim()
  .replace(/\/+$/, '');

const DISCORD_REDIRECT_URI = (
  (import.meta.env.DOME_REDIRECT_URI as string | undefined) ??
  (import.meta.env.DOME_DISCORD_REDIRECT_URI as string | undefined) ??
  (import.meta.env.VITE_DOME_REDIRECT_URI as string | undefined) ??
  (import.meta.env.VITE_DOME_DISCORD_REDIRECT_URI as string | undefined) ??
  'https://domestudios.com.br/domelauncher'
).trim();

const DISCORD_SCOPES = (
  (import.meta.env.DOME_DISCORD_SCOPES as string | undefined) ??
  (import.meta.env.VITE_DOME_DISCORD_SCOPES as string | undefined) ??
  'identify'
).trim();

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

export default function SocialSidebar({ usuarioMinecraft }: SocialSidebarProps) {
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

  const [amigos, setAmigos] = useState<AmigoSocial[]>([]);
  const [pendentesRecebidas, setPendentesRecebidas] = useState<SolicitacaoRecebida[]>([]);
  const [pendentesEnviadas, setPendentesEnviadas] = useState<SolicitacaoEnviada[]>([]);
  const [carregandoAmigos, setCarregandoAmigos] = useState(false);
  const [erroAmigos, setErroAmigos] = useState<string | null>(null);
  const [handleNovoAmigo, setHandleNovoAmigo] = useState('');
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [mensagemSolicitacao, setMensagemSolicitacao] = useState<string | null>(null);

  const [amigoSelecionadoPerfilId, setAmigoSelecionadoPerfilId] = useState<string | null>(null);
  const [mensagensChat, setMensagensChat] = useState<MensagemChatApi[]>([]);
  const [textoChat, setTextoChat] = useState('');
  const [carregandoChat, setCarregandoChat] = useState(false);
  const [enviandoChat, setEnviandoChat] = useState(false);
  const [erroChat, setErroChat] = useState<string | null>(null);

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

  const atualizarSessao = useCallback((novaSessao: SessaoSocial | null) => {
    setSessao(novaSessao);
    setPerfil(novaSessao?.perfil ?? null);
    salvarSessaoLocal(novaSessao);
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
    } catch (erro) {
      setErroChat(mensagemErro(erro, 'Nao foi possivel carregar o chat.'));
    } finally {
      setCarregandoChat(false);
    }
  }, [amigoSelecionadoPerfilId, obterTokenValido]);

  useEffect(() => {
    const sessaoLocal = lerSessaoLocal();
    atualizarSessao(sessaoLocal);
    setCarregandoSessao(false);
  }, [atualizarSessao]);

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
    };

    carregar();
    return () => {
      ativo = false;
    };
  }, [atualizarSessao, carregarAmigos, carregarPerfilSocial, sessao?.accessToken, sessao?.expiraEm, sessao?.refreshToken]);

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
      setErroPerfil('Configure DOME_API_PUBLIC_URL, DOME_CLIENT_ID e DOME_REDIRECT_URI.');
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
      <aside className="hidden xl:flex w-80 shrink-0 border-l border-white/10 bg-[#0d0d0d] p-4 overflow-y-auto scrollbar-hide">
        <div className="flex w-full items-center justify-center text-xs text-white/60">
          <Loader2 size={12} className="animate-spin" />
          <span className="ml-2">Carregando social...</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden xl:flex w-80 shrink-0 border-l border-white/10 bg-[#0d0d0d] p-4 overflow-y-auto scrollbar-hide">
      <div className="flex w-full flex-col gap-4">
        <div className={cn(sessao ? 'px-0 py-1' : 'border border-white/10 bg-[#151515] p-3')}>
          {!sessao && <p className="mb-2 text-xs font-black uppercase tracking-wide text-white/75">Social</p>}

          {!sessao && (
            <div className="space-y-2">
              <p className="text-xs text-white/55">Logue com Discord para liberar social, amigos e chat.</p>
              <button
                onClick={iniciarLoginDiscord}
                className="w-full border border-white/20 bg-[#202020] px-2 py-2 text-xs font-black uppercase tracking-wide text-white hover:border-white/40"
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

        <div className="border border-white/10 bg-[#151515] p-3">
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
              <div className="flex gap-2">
                <input
                  value={handleNovoAmigo}
                  onChange={(e) => setHandleNovoAmigo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && enviarSolicitacaoPorHandle()}
                  placeholder="Buscar amigos..."
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
                    <p key={pendente.id} className="truncate text-[11px] text-white/65">{pendente.paraNome} {pendente.paraHandle ? `@${pendente.paraHandle}` : ''} ({tempoRelativo(pendente.criadoEm)})</p>
                  ))}
                </div>
              )}

              {mensagemSolicitacao && <p className="text-[11px] text-white/65">{mensagemSolicitacao}</p>}
            </div>
          )}

          {!sessao && <p className="py-4 text-center text-xs text-white/45">Faça login com Discord para ver e adicionar amigos.</p>}
          {sessao && carregandoAmigos && <div className="flex items-center justify-center gap-2 py-4 text-xs text-white/60"><Loader2 size={12} className="animate-spin" />Carregando amigos...</div>}
          {sessao && !carregandoAmigos && erroAmigos && <p className="py-4 text-center text-xs text-red-300/85">{erroAmigos}</p>}
          {sessao && !carregandoAmigos && !erroAmigos && amigos.length === 0 && <p className="py-4 text-center text-xs text-white/45">Voce ainda nao tem amigos adicionados.</p>}

          {sessao && !carregandoAmigos && !erroAmigos && amigos.length > 0 && (
            <div className="space-y-2">
              {amigos.slice(0, 12).map((amigo) => (
                <button
                  key={amigo.friendProfileId}
                  onClick={() => setAmigoSelecionadoPerfilId(amigo.friendProfileId)}
                  className={cn(
                    'w-full text-left flex items-center gap-2 border px-2 py-1.5',
                    amigoSelecionadoPerfilId === amigo.friendProfileId ? 'border-emerald-400/35 bg-emerald-500/10' : 'border-white/10 bg-[#101010]'
                  )}
                >
                  <div className={cn('h-7 w-7 border border-white/15', amigo.online ? 'bg-emerald-500/30' : 'bg-[#222]')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-white/90">{amigo.nome}</p>
                    <p className={cn('truncate text-[10px]', amigo.online ? 'text-emerald-300/95' : 'text-white/45')}>
                      {amigo.online ? `Online${amigo.handle ? ` · @${amigo.handle}` : ''}` : `Visto ${tempoRelativo(amigo.ultimoSeenEm)}`}
                    </p>
                  </div>
                </button>
              ))}

              {amigoSelecionado && (
                <div className="border border-white/10 bg-[#111111] p-2">
                  <p className="truncate text-[11px] font-bold text-white/90">Chat com {amigoSelecionado.nome}</p>

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
    </aside>
  );
}
