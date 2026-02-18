import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Pencil, Play, Users } from "../iconesPixelados";
import { cn } from "../lib/utils";

interface ContaMinecraft {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

interface PerfilDiscordSocial {
  id: string;
  username: string;
  globalName?: string | null;
  avatar?: string | null;
  handle: string;
}

interface PerfilSocialApi {
  uuid: string;
  nomeSocial?: string | null;
  handle?: string | null;
  discord?: {
    id?: string | null;
    username?: string | null;
    globalName?: string | null;
    avatar?: string | null;
  } | null;
}

interface AmigoLauncher {
  uuid: string;
  nome: string;
  handle?: string | null;
  online: boolean;
  ultimoLogin?: string | null;
}

interface RespostaAmigosApi {
  amigos: AmigoLauncher[];
  pendentes: Array<{ id: string; deUuid: string; deNome: string; criadoEm: string }>;
}

interface MensagemChatApi {
  id: string;
  deUuid: string;
  paraUuid: string;
  conteudo: string;
  criadoEm: string;
}

interface RespostaChatMensagensApi {
  conversaId: string;
  mensagens: MensagemChatApi[];
}

interface RegistroCache<T> {
  criadoEm: number;
  dados: T;
}

interface SocialSidebarProps {
  usuarioMinecraft: ContaMinecraft | null;
}

const PREFIXO_CACHE_AMIGOS = "dome:social:amigos:";
const TTL_CACHE_AMIGOS_MS = 60 * 1000;
const CHAVE_DISCORD_SOCIAL_ATIVO = "dome:social:discord:ativo";
const URL_API_DOME_LAUNCHER_PADRAO = "https://api.domestudios.com.br";

const urlApi = (
  (import.meta.env.DOME_API_PUBLIC_URL as string | undefined) ??
  (import.meta.env.DOME_API_URL as string | undefined) ??
  (import.meta.env.VITE_DOME_API_PUBLIC_URL as string | undefined) ??
  (import.meta.env.VITE_DOME_API_URL as string | undefined) ??
  (import.meta.env.VITE_API_PUBLIC_URL as string | undefined)
)
  ?.trim()
  .replace(/\/+$/, "");

const API_DOME_LAUNCHER_URL =
  urlApi && urlApi.length > 0 ? urlApi : URL_API_DOME_LAUNCHER_PADRAO;

const DISCORD_CLIENT_ID = (
  (import.meta.env.DOME_CLIENT_ID as string | undefined) ??
  (import.meta.env.DOME_DISCORD_CLIENT_ID as string | undefined) ??
  (import.meta.env.VITE_DOME_CLIENT_ID as string | undefined) ??
  (import.meta.env.VITE_DOME_DISCORD_CLIENT_ID as string | undefined)
)
  ?.trim()
  .replace(/\/+$/, "");

const DISCORD_CLIENT_SECRET = (
  (import.meta.env.DOME_CLIENT_SECRET as string | undefined) ??
  (import.meta.env.DOME_DISCORD_CLIENT_SECRET as string | undefined) ??
  (import.meta.env.VITE_DOME_CLIENT_SECRET as string | undefined) ??
  (import.meta.env.VITE_DOME_DISCORD_CLIENT_SECRET as string | undefined)
)
  ?.trim();

const DISCORD_REDIRECT_URI = (
  (import.meta.env.DOME_REDIRECT_URI as string | undefined) ??
  (import.meta.env.DOME_DISCORD_REDIRECT_URI as string | undefined) ??
  (import.meta.env.VITE_DOME_REDIRECT_URI as string | undefined) ??
  (import.meta.env.VITE_DOME_DISCORD_REDIRECT_URI as string | undefined) ??
  "https://domestudios.com.br/domelauncher"
).trim();

const DISCORD_SCOPES = (
  (import.meta.env.DOME_DISCORD_SCOPES as string | undefined) ??
  (import.meta.env.VITE_DOME_DISCORD_SCOPES as string | undefined) ??
  "identify"
).trim();

function validarData(data: string): Date | null {
  const dataConvertida = new Date(data);
  return Number.isNaN(dataConvertida.getTime()) ? null : dataConvertida;
}

function tempoRelativo(data: string): string {
  const dataBase = validarData(data);
  if (!dataBase) return "data indisponível";
  const diff = Date.now() - dataBase.getTime();
  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "há 1 dia";
  if (dias < 7) return `há ${dias} dias`;
  return dataBase.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function lerCache<T>(chave: string, ttlMs: number): T | null {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    const registro = JSON.parse(bruto) as RegistroCache<T>;
    if (!registro || typeof registro.criadoEm !== "number") return null;
    if (Date.now() - registro.criadoEm > ttlMs) {
      localStorage.removeItem(chave);
      return null;
    }
    return registro.dados;
  } catch {
    return null;
  }
}

function salvarCache<T>(chave: string, dados: T): void {
  try {
    localStorage.setItem(chave, JSON.stringify({ criadoEm: Date.now(), dados }));
  } catch {
    // Ignorar cache local
  }
}

function normalizarHandle(handle: string): string | null {
  const valor = handle.trim().toLowerCase().replace(/^@+/, "");
  if (!valor) return null;
  if (!/^[a-z0-9._]{3,24}$/.test(valor)) return null;
  return valor;
}

function mensagemErro(erro: unknown, padrao: string): string {
  if (erro instanceof Error && erro.message.trim()) return erro.message;
  return padrao;
}

export default function SocialSidebar({ usuarioMinecraft }: SocialSidebarProps) {
  const [discordSocialAtivo, setDiscordSocialAtivo] = useState(
    () => localStorage.getItem(CHAVE_DISCORD_SOCIAL_ATIVO) === "1"
  );
  const [perfilSocial, setPerfilSocial] = useState<PerfilSocialApi | null>(null);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState<string | null>(null);
  const [mensagemPerfil, setMensagemPerfil] = useState<string | null>(null);
  const [nomeSocialEditavel, setNomeSocialEditavel] = useState("");
  const [handleEditavel, setHandleEditavel] = useState("");
  const [discordAuth, setDiscordAuth] = useState<PerfilDiscordSocial | null>(null);

  const [amigos, setAmigos] = useState<AmigoLauncher[]>([]);
  const [pendentesAmizade, setPendentesAmizade] = useState(0);
  const [carregandoAmigos, setCarregandoAmigos] = useState(false);
  const [erroAmigos, setErroAmigos] = useState<string | null>(null);
  const [versaoAmigos, setVersaoAmigos] = useState(0);
  const [handleNovoAmigo, setHandleNovoAmigo] = useState("");
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [mensagemSolicitacao, setMensagemSolicitacao] = useState<string | null>(null);

  const [amigoSelecionadoUuid, setAmigoSelecionadoUuid] = useState<string | null>(null);
  const [mensagensChat, setMensagensChat] = useState<MensagemChatApi[]>([]);
  const [textoChat, setTextoChat] = useState("");
  const [carregandoChat, setCarregandoChat] = useState(false);
  const [enviandoChat, setEnviandoChat] = useState(false);
  const [erroChat, setErroChat] = useState<string | null>(null);
  const [versaoChat, setVersaoChat] = useState(0);

  const nomeExibicaoAtual = useMemo(() => {
    if (editandoPerfil && nomeSocialEditavel.trim()) return nomeSocialEditavel.trim();
    const nomeSalvo = (perfilSocial?.nomeSocial ?? "").trim();
    if (nomeSalvo) return nomeSalvo;
    if (discordAuth?.globalName?.trim()) return discordAuth.globalName.trim();
    if (discordAuth?.username?.trim()) return discordAuth.username.trim();
    return usuarioMinecraft?.name ?? "Sem nome";
  }, [discordAuth?.globalName, discordAuth?.username, editandoPerfil, nomeSocialEditavel, perfilSocial?.nomeSocial, usuarioMinecraft?.name]);

  const handleExibicaoAtual = useMemo(() => {
    const origem = editandoPerfil ? handleEditavel : (perfilSocial?.handle ?? "");
    return normalizarHandle(origem) ?? "sem_handle";
  }, [editandoPerfil, handleEditavel, perfilSocial?.handle]);

  const amigoSelecionado = useMemo(
    () => (amigoSelecionadoUuid ? amigos.find((a) => a.uuid === amigoSelecionadoUuid) ?? null : null),
    [amigoSelecionadoUuid, amigos]
  );

  useEffect(() => {
    localStorage.setItem(CHAVE_DISCORD_SOCIAL_ATIVO, discordSocialAtivo ? "1" : "0");
  }, [discordSocialAtivo]);

  useEffect(() => {
    if (!discordSocialAtivo) {
      setEditandoPerfil(false);
      setAmigoSelecionadoUuid(null);
      setMensagensChat([]);
    }
  }, [discordSocialAtivo]);

  useEffect(() => {
    let cancelado = false;
    const carregarPerfil = async () => {
      if (!usuarioMinecraft?.uuid || !API_DOME_LAUNCHER_URL) return;
      setCarregandoPerfil(true);
      setErroPerfil(null);
      try {
        const perfil = await invoke<PerfilSocialApi>("get_launcher_social_profile", {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          uuid: usuarioMinecraft.uuid,
        });
        if (cancelado) return;
        setPerfilSocial(perfil);
        setNomeSocialEditavel((perfil.nomeSocial ?? "").trim());
        setHandleEditavel((perfil.handle ?? "").trim());
      } catch (erro) {
        if (!cancelado) setErroPerfil(mensagemErro(erro, "Não foi possível carregar o perfil social."));
      } finally {
        if (!cancelado) setCarregandoPerfil(false);
      }
    };
    carregarPerfil();
    return () => {
      cancelado = true;
    };
  }, [usuarioMinecraft?.uuid]);

  useEffect(() => {
    let cancelado = false;
    const carregarAmigos = async () => {
      if (!discordSocialAtivo || !usuarioMinecraft?.uuid || !API_DOME_LAUNCHER_URL) return;
      setCarregandoAmigos(true);
      setErroAmigos(null);
      const chave = `${PREFIXO_CACHE_AMIGOS}${usuarioMinecraft.uuid}`;
      const cache = lerCache<RespostaAmigosApi>(chave, TTL_CACHE_AMIGOS_MS);
      if (cache) {
        setAmigos(cache.amigos ?? []);
        setPendentesAmizade(cache.pendentes?.length ?? 0);
        setCarregandoAmigos(false);
        return;
      }
      try {
        const dados = await invoke<RespostaAmigosApi>("get_launcher_friends", {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          uuid: usuarioMinecraft.uuid,
        });
        if (cancelado) return;
        setAmigos(dados.amigos ?? []);
        setPendentesAmizade(dados.pendentes?.length ?? 0);
        salvarCache(chave, dados);
      } catch {
        if (!cancelado) setErroAmigos("Não foi possível carregar seus amigos.");
      } finally {
        if (!cancelado) setCarregandoAmigos(false);
      }
    };
    carregarAmigos();
    return () => {
      cancelado = true;
    };
  }, [discordSocialAtivo, usuarioMinecraft?.uuid, versaoAmigos]);

  useEffect(() => {
    if (!amigos.length) return;
    if (!amigoSelecionadoUuid || !amigos.some((a) => a.uuid === amigoSelecionadoUuid)) {
      setAmigoSelecionadoUuid(amigos[0].uuid);
    }
  }, [amigoSelecionadoUuid, amigos]);

  useEffect(() => {
    let cancelado = false;
    const carregarChat = async () => {
      if (!discordSocialAtivo || !usuarioMinecraft?.uuid || !amigoSelecionadoUuid) return;
      setCarregandoChat(true);
      setErroChat(null);
      try {
        const dados = await invoke<RespostaChatMensagensApi>("get_launcher_chat_messages", {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          uuid: usuarioMinecraft.uuid,
          amigoUuid: amigoSelecionadoUuid,
          limite: 80,
        });
        if (!cancelado) setMensagensChat(dados.mensagens ?? []);
      } catch (erro) {
        if (!cancelado) setErroChat(mensagemErro(erro, "Não foi possível carregar o chat."));
      } finally {
        if (!cancelado) setCarregandoChat(false);
      }
    };
    carregarChat();
    return () => {
      cancelado = true;
    };
  }, [amigoSelecionadoUuid, discordSocialAtivo, usuarioMinecraft?.uuid, versaoChat]);

  const abrirEdicaoPerfil = () => {
    setMensagemPerfil(null);
    setErroPerfil(null);
    setNomeSocialEditavel((perfilSocial?.nomeSocial ?? "").trim());
    setHandleEditavel((perfilSocial?.handle ?? "").trim());
    setEditandoPerfil(true);
  };

  const salvarPerfilSocial = async (extrasDiscord?: { id?: string | null; username?: string | null; globalName?: string | null; avatar?: string | null }) => {
    if (!usuarioMinecraft?.uuid || !API_DOME_LAUNCHER_URL) return;
    const handleNormalizado = normalizarHandle(handleEditavel);
    if (handleEditavel.trim() && !handleNormalizado) {
      setErroPerfil("Handle inválido. Use 3-24 caracteres: letras, números, ponto e _");
      return;
    }
    setSalvandoPerfil(true);
    setErroPerfil(null);
    setMensagemPerfil(null);
    try {
      const dados = await invoke<{ perfil?: PerfilSocialApi }>("save_launcher_social_profile", {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        payload: {
          uuid: usuarioMinecraft.uuid,
          nomeSocial: nomeSocialEditavel.trim(),
          handle: handleNormalizado,
          discordId: extrasDiscord?.id ?? perfilSocial?.discord?.id ?? null,
          discordUsername: extrasDiscord?.username ?? perfilSocial?.discord?.username ?? null,
          discordGlobalName: extrasDiscord?.globalName ?? perfilSocial?.discord?.globalName ?? null,
          discordAvatar: extrasDiscord?.avatar ?? perfilSocial?.discord?.avatar ?? null,
        },
      });
      if (dados?.perfil) {
        setPerfilSocial(dados.perfil);
        setNomeSocialEditavel((dados.perfil.nomeSocial ?? "").trim());
        setHandleEditavel((dados.perfil.handle ?? "").trim());
      }
      setMensagemPerfil("Perfil social atualizado.");
      setEditandoPerfil(false);
    } catch (erro) {
      const msg = mensagemErro(erro, "Não foi possível salvar o perfil social.");
      setErroPerfil(msg.toLowerCase().includes("handle já está em uso") ? "Handle já está em uso. Escolha outro." : msg);
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const iniciarLoginDiscord = async () => {
    setMensagemPerfil(null);
    setErroPerfil(null);
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
      setErroPerfil("Configure DOME_CLIENT_ID, DOME_CLIENT_SECRET e DOME_REDIRECT_URI.");
      return;
    }
    try {
      const perfilDiscord = await invoke<PerfilDiscordSocial>("login_discord_social", {
        clientId: DISCORD_CLIENT_ID,
        clientSecret: DISCORD_CLIENT_SECRET,
        redirectUri: DISCORD_REDIRECT_URI,
        scope: DISCORD_SCOPES,
      });
      setDiscordAuth(perfilDiscord);
      setDiscordSocialAtivo(true);
      if (!nomeSocialEditavel.trim()) setNomeSocialEditavel((perfilDiscord.globalName ?? perfilDiscord.username ?? "").trim());
      if (!handleEditavel.trim()) setHandleEditavel((perfilDiscord.handle ?? perfilDiscord.username).trim());
      if (usuarioMinecraft?.uuid) await salvarPerfilSocial({ id: perfilDiscord.id, username: perfilDiscord.username, globalName: perfilDiscord.globalName ?? null, avatar: perfilDiscord.avatar ?? null });
    } catch (erro) {
      setErroPerfil(mensagemErro(erro, "Não foi possível autenticar com Discord."));
    }
  };

  const enviarSolicitacaoPorHandle = async () => {
    if (!usuarioMinecraft?.uuid || !API_DOME_LAUNCHER_URL) return;
    const handleNormalizado = normalizarHandle(handleNovoAmigo);
    if (!handleNormalizado) {
      setMensagemSolicitacao("Handle inválido.");
      return;
    }
    setEnviandoSolicitacao(true);
    setMensagemSolicitacao(null);
    try {
      await invoke("send_launcher_friend_request_by_handle", {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        payload: { solicitanteUuid: usuarioMinecraft.uuid, handle: handleNormalizado },
      });
      setHandleNovoAmigo("");
      setMensagemSolicitacao("Solicitação enviada.");
      localStorage.removeItem(`${PREFIXO_CACHE_AMIGOS}${usuarioMinecraft.uuid}`);
      setVersaoAmigos((v) => v + 1);
    } catch (erro) {
      setMensagemSolicitacao(mensagemErro(erro, "Falha ao enviar solicitação."));
    } finally {
      setEnviandoSolicitacao(false);
    }
  };

  const enviarMensagemChat = async () => {
    if (!usuarioMinecraft?.uuid || !amigoSelecionadoUuid || !textoChat.trim()) return;
    setEnviandoChat(true);
    setErroChat(null);
    try {
      const mensagem = await invoke<MensagemChatApi>("send_launcher_chat_message", {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        payload: { deUuid: usuarioMinecraft.uuid, paraUuid: amigoSelecionadoUuid, conteudo: textoChat.trim() },
      });
      setTextoChat("");
      setMensagensChat((anterior) => [...anterior, mensagem]);
      setVersaoChat((v) => v + 1);
    } catch (erro) {
      setErroChat(mensagemErro(erro, "Não foi possível enviar a mensagem."));
    } finally {
      setEnviandoChat(false);
    }
  };

  const aoPressionarEnterMensagem = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key !== "Enter" || evento.shiftKey) return;
    evento.preventDefault();
    enviarMensagemChat();
  };

  return (
    <aside className="hidden xl:flex w-80 shrink-0 border-l border-white/10 bg-[#0d0d0d] p-4 overflow-y-auto scrollbar-hide">
      <div className="flex w-full flex-col gap-4">
        <div className={cn(discordSocialAtivo ? "px-0 py-1" : "border border-white/10 bg-[#151515] p-3")}>
          {!discordSocialAtivo && <p className="mb-2 text-xs font-black uppercase tracking-wide text-white/75">Social</p>}
          {!discordSocialAtivo && (
            <div className="space-y-2">
              <p className="text-xs text-white/55">Logue com o Discord para liberar o social e configurar seu perfil.</p>
              <button onClick={iniciarLoginDiscord} className="w-full border border-white/20 bg-[#202020] px-2 py-2 text-xs font-black uppercase tracking-wide text-white hover:border-white/40">Entrar com Discord</button>
              {erroPerfil && <p className="text-[11px] text-red-300/90">{erroPerfil}</p>}
              {!erroPerfil && mensagemPerfil && <p className="text-[11px] text-emerald-300/90">{mensagemPerfil}</p>}
            </div>
          )}
          {discordSocialAtivo && usuarioMinecraft && (
            <div className="space-y-2">
              <div className="group flex items-center gap-2 px-1">
                <img src={`https://mc-heads.net/head/${usuarioMinecraft.uuid}/64`} alt={nomeExibicaoAtual} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-white">{nomeExibicaoAtual}</p>
                  <p className="truncate text-[10px] text-white/55">@{handleExibicaoAtual}</p>
                </div>
                <button onClick={abrirEdicaoPerfil} disabled={carregandoPerfil} aria-label="Editar perfil social" className={cn("opacity-0 transition-opacity group-hover:opacity-100", carregandoPerfil ? "cursor-not-allowed text-white/25" : "text-white/60 hover:text-white")}>
                  <Pencil size={12} />
                </button>
              </div>
              {editandoPerfil && (
                <div className="space-y-2 px-1">
                  <input value={nomeSocialEditavel} onChange={(e) => setNomeSocialEditavel(e.target.value)} placeholder="Nome social" className="w-full border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45" />
                  <input value={handleEditavel} onChange={(e) => setHandleEditavel(e.target.value)} placeholder="handle (sem @)" className="w-full border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45" />
                  <div className="flex gap-2">
                    <button onClick={() => setEditandoPerfil(false)} disabled={salvandoPerfil} className="flex-1 border border-white/15 bg-[#161616] px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/80 hover:text-white disabled:cursor-not-allowed disabled:text-white/40">Cancelar</button>
                    <button onClick={() => salvarPerfilSocial()} disabled={salvandoPerfil || carregandoPerfil} className="flex-1 border border-white/20 bg-[#202020] px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/85 hover:border-white/40 disabled:cursor-not-allowed disabled:text-white/40">{salvandoPerfil ? "Salvando..." : "Salvar"}</button>
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
            {pendentesAmizade > 0 && <span className="inline-flex items-center border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">{pendentesAmizade} pendente{pendentesAmizade > 1 ? "s" : ""}</span>}
          </div>

          {discordSocialAtivo && usuarioMinecraft && (
            <div className="mb-3 space-y-2">
              <div className="flex gap-2">
                <input value={handleNovoAmigo} onChange={(e) => setHandleNovoAmigo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enviarSolicitacaoPorHandle()} placeholder="Adicionar..." className="min-w-0 flex-1 border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45" />
                <button onClick={enviarSolicitacaoPorHandle} disabled={enviandoSolicitacao} className={cn("border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide", enviandoSolicitacao ? "cursor-not-allowed border-white/10 bg-[#151515] text-white/40" : "border-white/20 bg-[#202020] text-white/85 hover:border-white/40")}>{enviandoSolicitacao ? "..." : "Adicionar"}</button>
              </div>
              {mensagemSolicitacao && <p className="text-[11px] text-white/65">{mensagemSolicitacao}</p>}
            </div>
          )}

          {!discordSocialAtivo && <p className="py-4 text-center text-xs text-white/45">Faça login com o Discord para ver e adicionar amigos.</p>}
          {discordSocialAtivo && carregandoAmigos && <div className="flex items-center justify-center gap-2 py-4 text-xs text-white/60"><Loader2 size={12} className="animate-spin" />Carregando amigos...</div>}
          {discordSocialAtivo && !carregandoAmigos && erroAmigos && <p className="py-4 text-center text-xs text-red-300/85">{erroAmigos}</p>}
          {discordSocialAtivo && !carregandoAmigos && !erroAmigos && amigos.length === 0 && <p className="py-4 text-center text-xs text-white/45">Você ainda não tem amigos adicionados.</p>}

          {discordSocialAtivo && !carregandoAmigos && !erroAmigos && amigos.length > 0 && (
            <div className="space-y-2">
              {amigos.slice(0, 12).map((amigo) => (
                <button key={amigo.uuid} onClick={() => setAmigoSelecionadoUuid(amigo.uuid)} className={cn("w-full text-left flex items-center gap-2 border px-2 py-1.5", amigoSelecionadoUuid === amigo.uuid ? "border-emerald-400/35 bg-emerald-500/10" : "border-white/10 bg-[#101010]")}>
                  <img src={`https://mc-heads.net/avatar/${amigo.uuid}/32`} alt={amigo.nome} className="h-7 w-7 border border-white/15" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-white/90">{amigo.nome}</p>
                    <p className={cn("truncate text-[10px]", amigo.online ? "text-emerald-300/95" : "text-white/45")}>
                      {amigo.online ? `Online${amigo.handle ? ` · @${amigo.handle}` : ""}` : amigo.ultimoLogin ? `Visto ${tempoRelativo(amigo.ultimoLogin)}` : "Offline"}
                    </p>
                  </div>
                </button>
              ))}

              {amigoSelecionado && (
                <div className="mt-3 border border-white/10 bg-[#101010] p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="truncate text-[11px] font-bold text-white/90">Chat com {amigoSelecionado.nome}</p>
                    {carregandoChat && <Loader2 size={11} className="animate-spin text-white/55" />}
                  </div>
                  <div className="mb-2 h-40 overflow-y-auto border border-white/10 bg-[#0c0c0c] p-2">
                    {erroChat ? <p className="text-[11px] text-red-300/85">{erroChat}</p> : mensagensChat.length === 0 ? <p className="text-[11px] text-white/45">Sem mensagens ainda.</p> : (
                      <div className="space-y-1.5">
                        {mensagensChat.map((mensagem) => {
                          const ehMinha = mensagem.deUuid === usuarioMinecraft?.uuid;
                          return (
                            <div key={mensagem.id} className={cn("max-w-[85%] border px-2 py-1", ehMinha ? "ml-auto border-emerald-400/35 bg-emerald-500/10 text-white/90" : "mr-auto border-white/15 bg-[#151515] text-white/80")}>
                              <p className="text-[11px]">{mensagem.conteudo}</p>
                              <p className="mt-0.5 text-[9px] text-white/45">{validarData(mensagem.criadoEm)?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input value={textoChat} onChange={(e) => setTextoChat(e.target.value)} onKeyDown={aoPressionarEnterMensagem} placeholder={`Mensagem para ${amigoSelecionado.nome}`} className="min-w-0 flex-1 border border-white/15 bg-[#161616] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45" />
                    <button onClick={enviarMensagemChat} disabled={enviandoChat || !textoChat.trim()} className={cn("inline-flex items-center justify-center border px-2", enviandoChat || !textoChat.trim() ? "cursor-not-allowed border-white/10 bg-[#151515] text-white/35" : "border-white/20 bg-[#202020] text-white/85 hover:border-white/40")}>
                      {enviandoChat ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
