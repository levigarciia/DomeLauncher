import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Gamepad2,
  Loader2,
} from "../iconesPixelados";
import { cn } from "../lib/utils";
import type { Instance } from "../hooks/useLauncher";
import {
  addCreatingInstance,
  completeCreatingInstance,
  errorCreatingInstance,
  type CreatingInstance,
  updateCreatingInstance,
} from "../stores/creatingInstances";

export type TipoProjetoConteudo = "modpack" | "mod" | "resourcepack" | "shader";
export type FonteProjetoConteudo = "modrinth" | "curseforge";
export type AbaOrigemProjeto = "home" | "explore" | "favorites";
type AbaConteudoProjeto = "descricao" | "versoes" | "galeria";

interface ImagemGaleriaProjeto {
  url: string;
  raw_url?: string;
  title?: string;
  description?: string;
  featured?: boolean;
}

export interface ProjetoConteudo {
  id: string;
  title: string;
  description: string;
  icon_url: string;
  author: string;
  slug: string;
  source: FonteProjetoConteudo;
  project_type: TipoProjetoConteudo;
  downloads?: number;
  follows?: number;
  body?: string;
  categorias?: string[];
  galeria?: ImagemGaleriaProjeto[];
}

interface ArquivoProjeto {
  url: string;
  filename: string;
  primary?: boolean;
}

interface VersaoProjetoModrinth {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published?: string;
  files: ArquivoProjeto[];
}

interface CompatibilidadeInstancia {
  instancia: Instance;
  versaoIdeal: VersaoProjetoModrinth | null;
  arquivoIdeal: ArquivoProjeto | null;
  motivoIncompatibilidade: string | null;
}

interface LoaderVersionsResponse {
  versions: Array<{ version: string; stable?: boolean }>;
}

interface ProjetoDetalhePaginaProps {
  projeto: ProjetoConteudo;
  instancias: Instance[];
  usuarioLogado?: boolean;
  onSolicitarLogin?: () => void;
  onVoltar: () => void;
}

const ORDEM_LOADER_MODPACK = ["fabric", "forge", "neoforge"] as const;

const COMPONENTES_MARKDOWN: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 text-2xl font-black text-white first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 text-xl font-black text-white first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 text-lg font-bold text-white first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="leading-7 text-white/85">{children}</p>,
  strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
  em: ({ children }) => <em className="text-white/80 italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6 text-white/85">{children}</ul>,
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-6 text-white/85">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-6">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-white/20 pl-4 text-white/70 italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cn("rounded bg-black/45 px-1.5 py-0.5 text-xs text-white", className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3 text-xs text-white">
      {children}
    </pre>
  ),
  img: ({ src, alt }) => (
    <img
      src={src || ""}
      alt={alt || ""}
      loading="lazy"
      className="mx-auto my-3 block h-auto max-h-[420px] w-auto max-w-full rounded-xl border border-white/10 bg-black/35 object-contain"
    />
  ),
};

function normalizarLoader(loader?: string | null): string | null {
  if (!loader) return null;
  const valor = loader.trim().toLowerCase();
  if (!valor || valor === "vanilla") return null;
  return valor;
}

function labelLoader(instancia: Instance): string {
  const loader = instancia.loader_type || instancia.mc_type;
  return loader && loader.trim() ? loader : "Vanilla";
}

function formatarNumero(numero: number): string {
  if (!Number.isFinite(numero)) return "0";
  if (numero >= 1_000_000) return `${(numero / 1_000_000).toFixed(1)}M`;
  if (numero >= 1_000) return `${(numero / 1_000).toFixed(1)}K`;
  return numero.toString();
}

function normalizarDescricaoProjeto(descricao: string): string {
  if (!descricao) return "";
  const possuiTagsEscapadas = /\\<(?:\/)?(?:center|p|span|font|img|a|iframe|ul|ol|li|strong|em|br|h[1-6]|div)/i.test(
    descricao
  );
  if (!possuiTagsEscapadas) return descricao;
  return descricao.replace(/\\</g, "<").replace(/\\>/g, ">");
}

function compararVersoesPorData(a: VersaoProjetoModrinth, b: VersaoProjetoModrinth): number {
  const dataA = a.date_published ? new Date(a.date_published).getTime() : 0;
  const dataB = b.date_published ? new Date(b.date_published).getTime() : 0;
  return dataB - dataA;
}

function tagVersaoCompativel(tag: string, versaoInstancia: string): boolean {
  if (tag === versaoInstancia) return true;
  const ehNumerica = /^[0-9.]+$/.test(tag);
  if (ehNumerica && tag.split(".").length === 2) {
    return versaoInstancia.startsWith(`${tag}.`);
  }
  return false;
}

function versaoMinecraftCompativel(tags: string[], versaoInstancia: string): boolean {
  if (tags.length === 0) return true;
  return tags.some((tag) => tagVersaoCompativel(tag, versaoInstancia));
}

function loaderCompativel(
  loadersVersao: string[],
  loaderInstancia: string | null,
  tipoProjeto: TipoProjetoConteudo
): boolean {
  if (tipoProjeto !== "mod") return true;
  if (loadersVersao.length === 0) return true;
  if (!loaderInstancia) return false;
  return loadersVersao.map((item) => item.toLowerCase()).includes(loaderInstancia);
}

function escolherArquivoIdeal(
  versao: VersaoProjetoModrinth,
  tipoProjeto: TipoProjetoConteudo
): ArquivoProjeto | null {
  const arquivos = versao.files || [];
  if (arquivos.length === 0) return null;

  const extensao =
    tipoProjeto === "modpack" ? ".mrpack" : tipoProjeto === "mod" ? ".jar" : ".zip";
  const primario = arquivos.find(
    (item) => item.primary && item.filename.toLowerCase().endsWith(extensao)
  );
  if (primario) return primario;
  const porExtensao = arquivos.find((item) =>
    item.filename.toLowerCase().endsWith(extensao)
  );
  return porExtensao || arquivos[0];
}

function escolherVersaoMinecraftIdeal(gameVersions: string[]): string | null {
  if (gameVersions.length === 0) return null;
  const releases = gameVersions.filter((item) => /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(item));
  if (releases.length === 0) return gameVersions[0] || null;
  releases.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return releases[0] || null;
}

function gerarNomeInstanciaDisponivel(nomeBase: string, nomesExistentes: string[]): string {
  const base = nomeBase.trim() || "Novo Modpack";
  const nomes = new Set(nomesExistentes.map((item) => item.toLowerCase()));
  if (!nomes.has(base.toLowerCase())) return base;
  let sufixo = 2;
  while (nomes.has(`${base} ${sufixo}`.toLowerCase())) sufixo += 1;
  return `${base} ${sufixo}`;
}

function gerarIdInstancia(nomeInstancia: string): string {
  return encodeURIComponent(nomeInstancia.toLowerCase().replace(/\s+/g, "_"));
}

function escolherVersaoLoaderIdeal(
  loader: string,
  versoes: Array<{ version: string; stable?: boolean }>,
  versaoMinecraft: string
): string | null {
  if (versoes.length === 0) return null;
  if (loader === "forge" || loader === "neoforge") {
    const compativel = versoes.find(
      (item) =>
        item.version.startsWith(`${versaoMinecraft}-`) || item.version.includes(versaoMinecraft)
    );
    return compativel?.version || versoes[0].version;
  }
  return versoes.find((item) => item.stable !== false)?.version || versoes[0].version;
}

function montarUrlProjeto(projeto: ProjetoConteudo): string {
  if (projeto.source === "modrinth") {
    return `https://modrinth.com/${projeto.project_type}/${projeto.slug}`;
  }
  if (projeto.project_type === "modpack") {
    return `https://www.curseforge.com/minecraft/modpacks/${projeto.slug}`;
  }
  if (projeto.project_type === "resourcepack") {
    return `https://www.curseforge.com/minecraft/texture-packs/${projeto.slug}`;
  }
  if (projeto.project_type === "shader") {
    return `https://www.curseforge.com/minecraft/shaders/${projeto.slug}`;
  }
  return `https://www.curseforge.com/minecraft/mc-mods/${projeto.slug}`;
}

function normalizarTipoProjeto(valor: string): TipoProjetoConteudo {
  if (valor === "modpack" || valor === "mod" || valor === "resourcepack" || valor === "shader") {
    return valor;
  }
  return "mod";
}

async function buscarDetalhesProjetoModrinth(projectId: string): Promise<Partial<ProjetoConteudo>> {
  const resposta = await fetch(`https://api.modrinth.com/v2/project/${projectId}`);
  if (!resposta.ok) {
    throw new Error(`Erro ao buscar detalhes (${resposta.status})`);
  }

  const dados = await resposta.json();
  const categorias = [
    ...(Array.isArray(dados.categories) ? dados.categories : []),
    ...(Array.isArray(dados.additional_categories) ? dados.additional_categories : []),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);

  const galeria = Array.isArray(dados.gallery)
    ? dados.gallery
        .filter((imagem: any) => typeof imagem?.url === "string" && imagem.url.trim().length > 0)
        .map(
          (imagem: any): ImagemGaleriaProjeto => ({
            url: imagem.url,
            raw_url: typeof imagem.raw_url === "string" ? imagem.raw_url : undefined,
            title: typeof imagem.title === "string" ? imagem.title : undefined,
            description: typeof imagem.description === "string" ? imagem.description : undefined,
            featured: Boolean(imagem.featured),
          })
        )
    : [];

  return {
    id: typeof dados.id === "string" ? dados.id : projectId,
    title: typeof dados.title === "string" ? dados.title : "",
    description: typeof dados.description === "string" ? dados.description : "",
    body: typeof dados.body === "string" ? dados.body : "",
    icon_url: typeof dados.icon_url === "string" ? dados.icon_url : "",
    slug: typeof dados.slug === "string" ? dados.slug : "",
    project_type: normalizarTipoProjeto(String(dados.project_type || "mod")),
    downloads: typeof dados.downloads === "number" ? dados.downloads : undefined,
    follows: typeof dados.followers === "number" ? dados.followers : undefined,
    categorias: categorias.length > 0 ? categorias : undefined,
    galeria,
  };
}

async function buscarVersoesProjetoModrinth(
  projectId: string
): Promise<VersaoProjetoModrinth[]> {
  const resposta = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`);
  if (!resposta.ok) {
    throw new Error(`Erro ao buscar versões (${resposta.status})`);
  }
  const dados = await resposta.json();
  if (!Array.isArray(dados)) return [];
  return dados.map((versao: any) => ({
    id: versao.id,
    version_number: versao.version_number,
    game_versions: Array.isArray(versao.game_versions) ? versao.game_versions : [],
    loaders: Array.isArray(versao.loaders) ? versao.loaders : [],
    date_published: versao.date_published,
    files: Array.isArray(versao.files)
      ? versao.files.map((arquivo: any) => ({
          url: arquivo.url,
          filename: arquivo.filename,
          primary: Boolean(arquivo.primary),
        }))
      : [],
  }));
}

export default function ProjetoDetalheModal({
  projeto,
  instancias,
  usuarioLogado = false,
  onSolicitarLogin,
  onVoltar,
}: ProjetoDetalhePaginaProps) {
  const [versoesProjeto, setVersoesProjeto] = useState<VersaoProjetoModrinth[]>([]);
  const [instanciaSelecionadaId, setInstanciaSelecionadaId] = useState<string | null>(null);
  const [abaConteudo, setAbaConteudo] = useState<AbaConteudoProjeto>("descricao");
  const [detalhesProjeto, setDetalhesProjeto] = useState<Partial<ProjetoConteudo> | null>(null);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [erroDetalhes, setErroDetalhes] = useState<string | null>(null);
  const [carregandoVersoes, setCarregandoVersoes] = useState(false);
  const [instalando, setInstalando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setAbaConteudo("descricao");
    setDetalhesProjeto(null);
    setErroDetalhes(null);
    setCarregandoDetalhes(projeto.source === "modrinth");

    const carregarDetalhes = async () => {
      if (projeto.source !== "modrinth") {
        setCarregandoDetalhes(false);
        return;
      }
      try {
        const detalhes = await buscarDetalhesProjetoModrinth(projeto.id);
        if (!cancelado) setDetalhesProjeto(detalhes);
      } catch (e) {
        if (!cancelado) {
          console.error("Erro ao buscar detalhes do projeto:", e);
          setErroDetalhes("Não foi possível carregar a descrição completa.");
        }
      } finally {
        if (!cancelado) setCarregandoDetalhes(false);
      }
    };

    carregarDetalhes();
    return () => {
      cancelado = true;
    };
  }, [projeto.id, projeto.source]);

  useEffect(() => {
    let cancelado = false;
    setVersoesProjeto([]);
    setErro(null);
    setSucesso(false);
    setCarregandoVersoes(projeto.source === "modrinth");

    const carregar = async () => {
      if (projeto.source !== "modrinth") return;
      try {
        const versoes = await buscarVersoesProjetoModrinth(projeto.id);
        if (!cancelado) setVersoesProjeto(versoes);
      } catch (e) {
        if (!cancelado) {
          console.error("Erro ao buscar versões:", e);
          setErro("Não foi possível carregar versões do projeto.");
        }
      } finally {
        if (!cancelado) setCarregandoVersoes(false);
      }
    };

    carregar();
    return () => {
      cancelado = true;
    };
  }, [projeto.id, projeto.source]);

  const projetoExibicao = useMemo<ProjetoConteudo>(
    () => ({
      ...projeto,
      ...detalhesProjeto,
      author: detalhesProjeto?.author || projeto.author,
    }),
    [detalhesProjeto, projeto]
  );

  const descricaoCompletaProjeto = useMemo(
    () => normalizarDescricaoProjeto(projetoExibicao.body?.trim() || ""),
    [projetoExibicao.body]
  );
  const galeriaProjeto = projetoExibicao.galeria || [];
  const instalacaoCurseforgeModpackNaoSuportada =
    projeto.source === "curseforge" && projeto.project_type === "modpack";
  const requerCompatibilidadeModrinth =
    projeto.source === "modrinth" && projeto.project_type !== "modpack";

  const compatibilidades = useMemo<CompatibilidadeInstancia[]>(() => {
    if (projeto.project_type === "modpack") return [];
    if (projeto.source === "curseforge") {
      return instancias.map((instancia) => ({
        instancia,
        versaoIdeal: null,
        arquivoIdeal: null,
        motivoIncompatibilidade: null,
      }));
    }

    const ordenadas = [...versoesProjeto].sort(compararVersoesPorData);
    return instancias.map((instancia) => {
      const loaderInstancia = normalizarLoader(instancia.loader_type || instancia.mc_type);
      let encontrouMc = false;
      let encontrouLoader = false;
      for (const versao of ordenadas) {
        if (!versaoMinecraftCompativel(versao.game_versions || [], instancia.version)) {
          continue;
        }
        encontrouMc = true;
        if (!loaderCompativel(versao.loaders || [], loaderInstancia, projeto.project_type)) {
          continue;
        }
        encontrouLoader = true;
        const arquivoIdeal = escolherArquivoIdeal(versao, projeto.project_type);
        if (!arquivoIdeal) continue;
        return {
          instancia,
          versaoIdeal: versao,
          arquivoIdeal,
          motivoIncompatibilidade: null,
        };
      }

      if (!encontrouMc) {
        return {
          instancia,
          versaoIdeal: null,
          arquivoIdeal: null,
          motivoIncompatibilidade: "Sem versão compatível com o Minecraft dessa instância",
        };
      }
      if (!encontrouLoader && projeto.project_type === "mod") {
        return {
          instancia,
          versaoIdeal: null,
          arquivoIdeal: null,
          motivoIncompatibilidade: "Sem compatibilidade com o loader da instância",
        };
      }
      return {
        instancia,
        versaoIdeal: null,
        arquivoIdeal: null,
        motivoIncompatibilidade: "Nenhum arquivo instalável encontrado para esta instância",
      };
    });
  }, [instancias, projeto.project_type, projeto.source, versoesProjeto]);

  useEffect(() => {
    if (projeto.project_type === "modpack") {
      setInstanciaSelecionadaId(null);
      return;
    }

    if (projeto.source === "curseforge") {
      setInstanciaSelecionadaId(instancias[0]?.id || null);
      return;
    }

    const primeiraCompativel = compatibilidades.find(
      (item) => item.versaoIdeal && item.arquivoIdeal
    );
    setInstanciaSelecionadaId(
      primeiraCompativel?.instancia.id || instancias[0]?.id || null
    );
  }, [compatibilidades, instancias, projeto.project_type]);

  const compatibilidadeSelecionada = useMemo(() => {
    if (!instanciaSelecionadaId) return null;
    return compatibilidades.find((item) => item.instancia.id === instanciaSelecionadaId) || null;
  }, [compatibilidades, instanciaSelecionadaId]);

  const versaoModpackIdeal = useMemo(() => {
    if (projeto.project_type !== "modpack") return null;
    const ordenadas = [...versoesProjeto].sort(compararVersoesPorData);
    return (
      ordenadas.find((versao) => {
        const arquivo = escolherArquivoIdeal(versao, "modpack");
        if (!arquivo) return false;
        const loaders = (versao.loaders || []).map((item) => item.toLowerCase());
        if (loaders.includes("quilt")) return false;
        if (loaders.length === 0) return true;
        return ORDEM_LOADER_MODPACK.some((loader) => loaders.includes(loader));
      }) || null
    );
  }, [projeto.project_type, versoesProjeto]);

  const instalarProjeto = async () => {
    if (instalando) return;

    if (projeto.project_type === "modpack") {
      if (projeto.source !== "modrinth") {
        setErro("Instalação automática de modpack CurseForge ainda não está disponível.");
        return;
      }
      if (!usuarioLogado) {
        onSolicitarLogin?.();
        setErro("Faça login para instalar modpacks como nova instância.");
        return;
      }
      if (!versaoModpackIdeal) {
        setErro("Nenhuma versão de modpack compatível foi encontrada.");
        return;
      }
      const arquivoModpack = escolherArquivoIdeal(versaoModpackIdeal, "modpack");
      const versaoMinecraft = escolherVersaoMinecraftIdeal(versaoModpackIdeal.game_versions || []);
      if (!arquivoModpack || !versaoMinecraft) {
        setErro("Não foi possível determinar arquivo ou versão ideal do modpack.");
        return;
      }

      setErro(null);
      setInstalando(true);
      let idOverlayCriacao = "";
      try {
        const loadersVersao = (versaoModpackIdeal.loaders || []).map((item) =>
          item.toLowerCase()
        );
        const loaderSelecionado =
          ORDEM_LOADER_MODPACK.find((loader) => loadersVersao.includes(loader)) || "vanilla";
        const nomeInstancia = gerarNomeInstanciaDisponivel(
          projetoExibicao.title,
          instancias.map((item) => item.name)
        );
        const idInstancia = gerarIdInstancia(nomeInstancia);
        idOverlayCriacao = `${idInstancia}_${Date.now().toString(36)}`;

        const criandoInstancia: CreatingInstance = {
          id: idOverlayCriacao,
          name: nomeInstancia,
          version: versaoMinecraft,
          type: loaderSelecionado,
          status: "downloading",
          progress: 0,
          message: "Preparando instalação do modpack...",
          icon: projetoExibicao.icon_url || "/dome.svg",
        };
        addCreatingInstance(criandoInstancia);

        let loaderVersion: string | undefined;
        if (loaderSelecionado !== "vanilla") {
          updateCreatingInstance(idOverlayCriacao, {
            progress: 8,
            message: "Buscando versão ideal do loader...",
          });
          const respostaLoader = await invoke<LoaderVersionsResponse>("get_loader_versions", {
            loaderType: loaderSelecionado,
          });
          loaderVersion =
            escolherVersaoLoaderIdeal(
              loaderSelecionado,
              respostaLoader.versions || [],
              versaoMinecraft
            ) || undefined;
          if (!loaderVersion) {
            throw new Error(`Nenhuma versão válida do ${loaderSelecionado} foi encontrada.`);
          }
        }

        updateCreatingInstance(idOverlayCriacao, {
          progress: 20,
          message: "Criando nova instância...",
        });

        const paramsCriacao: Record<string, unknown> = {
          name: nomeInstancia,
          version: versaoMinecraft,
          mcType: loaderSelecionado,
        };
        if (loaderSelecionado !== "vanilla") {
          paramsCriacao.loaderType = loaderSelecionado;
          paramsCriacao.loaderVersion = loaderVersion;
        }
        await invoke("create_instance", paramsCriacao);
        await invoke("save_modpack_info", {
          instanceId: idInstancia,
          modpackInfo: {
            projectId: projeto.id,
            versionId: versaoModpackIdeal.id,
            name: projetoExibicao.title,
            author: projetoExibicao.author,
            icon: projetoExibicao.icon_url,
            slug: projetoExibicao.slug,
            source: "modrinth",
            installedVersion: versaoModpackIdeal.version_number,
          },
        });
        await invoke("install_modpack_files", {
          instanceId: idInstancia,
          downloadUrl: arquivoModpack.url,
          fileName: arquivoModpack.filename,
        });
        completeCreatingInstance(idOverlayCriacao);
        setInstalando(false);
        setSucesso(true);
        setTimeout(() => window.location.reload(), 1000);
      } catch (e) {
        const mensagem = e instanceof Error ? e.message : "Falha ao instalar modpack.";
        setErro(mensagem);
        if (idOverlayCriacao) errorCreatingInstance(idOverlayCriacao, mensagem);
        setInstalando(false);
      }
      return;
    }

    const instanciaAlvo = instancias.find((item) => item.id === instanciaSelecionadaId);
    if (!instanciaAlvo) {
      setErro("Selecione uma instância para continuar.");
      return;
    }

    if (projeto.source === "curseforge") {
      setErro(null);
      setInstalando(true);
      try {
        if (projeto.project_type === "mod") {
          await invoke("install_mod", {
            instanceId: instanciaAlvo.id,
            modInfo: {
              id: projeto.id,
              name: projetoExibicao.title,
              description: projetoExibicao.description,
              author: projetoExibicao.author,
              version: "latest",
              download_url: "",
              file_name: "",
              platform: "curseforge",
              dependencies: [],
            },
          });
        } else {
          await invoke("install_curseforge_project_file", {
            instanceId: instanciaAlvo.id,
            projectType: projeto.project_type,
            projectId: projeto.id,
          });
        }
        setSucesso(true);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao instalar projeto CurseForge.");
      } finally {
        setInstalando(false);
      }
      return;
    }

    if (!compatibilidadeSelecionada?.versaoIdeal || !compatibilidadeSelecionada.arquivoIdeal) {
      setErro("Selecione uma instância compatível para continuar.");
      return;
    }

    setErro(null);
    setInstalando(true);
    try {
      if (projeto.project_type === "mod") {
        await invoke("install_mod", {
          instanceId: compatibilidadeSelecionada.instancia.id,
          modInfo: {
            id: projeto.id,
            name: projetoExibicao.title,
            description: projetoExibicao.description,
            author: projetoExibicao.author,
            version: compatibilidadeSelecionada.versaoIdeal.version_number,
            download_url: compatibilidadeSelecionada.arquivoIdeal.url,
            file_name: compatibilidadeSelecionada.arquivoIdeal.filename,
            platform: "modrinth",
            dependencies: [],
          },
        });
      } else {
        await invoke("install_project_file", {
          instanceId: compatibilidadeSelecionada.instancia.id,
          projectType: projeto.project_type,
          downloadUrl: compatibilidadeSelecionada.arquivoIdeal.url,
          fileName: compatibilidadeSelecionada.arquivoIdeal.filename,
        });
      }
      setSucesso(true);
      setInstalando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao instalar projeto.");
      setInstalando(false);
    }
  };

  return (
    <div className="min-h-full space-y-6">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onVoltar}
          className="inline-flex items-center gap-2 border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white/80 hover:bg-white/10"
        >
          <ArrowLeft size={13} />
          Voltar
        </button>

        <button
          onClick={instalarProjeto}
          disabled={
            instalando ||
            instalacaoCurseforgeModpackNaoSuportada ||
            (projeto.project_type !== "modpack" && !instanciaSelecionadaId) ||
            (projeto.project_type === "modpack" &&
              projeto.source === "modrinth" &&
              carregandoVersoes) ||
            (requerCompatibilidadeModrinth &&
              (!compatibilidadeSelecionada?.versaoIdeal || !compatibilidadeSelecionada.arquivoIdeal))
          }
          className={cn(
            "inline-flex items-center gap-2 border px-4 py-2 text-xs font-black uppercase tracking-wide",
            instalando
              ? "border-white/20 bg-white/10 text-white/45"
              : sucesso
                ? "border-emerald-300 bg-emerald-500 text-black"
                : "border-emerald-300 bg-emerald-500 text-black hover:bg-emerald-400"
          )}
        >
          {instalando ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Instalando...
            </>
          ) : sucesso ? (
            <>
              <Check size={13} />
              Instalado
            </>
          ) : (
            <>
              <Download size={13} />
              {instalacaoCurseforgeModpackNaoSuportada
                ? "Indisponível"
                : projeto.project_type === "modpack"
                  ? "Instalar"
                  : "Instalar"}
            </>
          )}
        </button>
      </div>

      <section className="border border-white/10 bg-[#141416]">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start gap-4">
            <img
              src={
                projetoExibicao.icon_url ||
                `https://api.dicebear.com/9.x/shapes/svg?seed=${projetoExibicao.id}`
              }
              alt={projetoExibicao.title}
              className="h-20 w-20 rounded-xl border border-white/15 bg-black/30 object-cover"
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-3xl font-black tracking-tight">{projetoExibicao.title}</h1>
              <p className="text-sm text-white/60">por {projetoExibicao.author}</p>
              <p className="mt-2 text-sm text-white/75">
                {projetoExibicao.description || "Sem descrição disponível."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/45">
                {typeof projetoExibicao.downloads === "number" && (
                  <span className="flex items-center gap-1">
                    <Download size={11} />
                    {formatarNumero(projetoExibicao.downloads)}
                  </span>
                )}
                {typeof projetoExibicao.follows === "number" && (
                  <span className="flex items-center gap-1">
                    <Check size={11} />
                    {formatarNumero(projetoExibicao.follows)}
                  </span>
                )}
                <span className="uppercase">{projetoExibicao.project_type}</span>
                <span className="uppercase">{projetoExibicao.source}</span>
                {(projetoExibicao.categorias || []).slice(0, 5).map((categoria) => (
                  <span
                    key={categoria}
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 capitalize text-white/60"
                  >
                    {categoria}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-white/10 px-5 py-3">
          <div className="inline-flex rounded-xl border border-white/10 bg-black/25 p-1">
            <button
              onClick={() => setAbaConteudo("descricao")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                abaConteudo === "descricao"
                  ? "bg-emerald-500 text-black"
                  : "text-white/60 hover:text-white"
              )}
            >
              Descrição
            </button>
            <button
              onClick={() => setAbaConteudo("versoes")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                abaConteudo === "versoes"
                  ? "bg-emerald-500 text-black"
                  : "text-white/60 hover:text-white"
              )}
            >
              Versões
            </button>
            <button
              onClick={() => setAbaConteudo("galeria")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                abaConteudo === "galeria"
                  ? "bg-emerald-500 text-black"
                  : "text-white/60 hover:text-white"
              )}
            >
              Galeria
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            {abaConteudo === "descricao" && (
              <>
                {carregandoDetalhes && !descricaoCompletaProjeto && (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <Loader2 size={14} className="animate-spin" />
                    Carregando descrição completa...
                  </div>
                )}
                {erroDetalhes && <p className="text-xs text-orange-200">{erroDetalhes}</p>}
                {descricaoCompletaProjeto ? (
                  <article className="space-y-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={COMPONENTES_MARKDOWN}
                    >
                      {descricaoCompletaProjeto}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <article className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/75 leading-7">
                    {projetoExibicao.description || "Sem descrição disponível."}
                  </article>
                )}
              </>
            )}

            {abaConteudo === "versoes" &&
              (carregandoVersoes ? (
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <Loader2 size={14} className="animate-spin" />
                  Carregando versões...
                </div>
              ) : versoesProjeto.length === 0 ? (
                <p className="text-sm text-white/55">Nenhuma versão encontrada para este projeto.</p>
              ) : (
                <div className="space-y-2">
                  {versoesProjeto.slice(0, 20).map((versao) => (
                    <div
                      key={versao.id}
                      className="border border-white/10 bg-black/20 px-3 py-2 text-xs"
                    >
                      <p className="font-bold text-white/90">{versao.version_number}</p>
                      <p className="mt-1 text-white/55">
                        MC: {(versao.game_versions || []).slice(0, 4).join(", ") || "qualquer"}
                      </p>
                      <p className="mt-0.5 text-white/55">
                        Loader: {(versao.loaders || []).join(", ") || "não informado"}
                      </p>
                    </div>
                  ))}
                </div>
              ))}

            {abaConteudo === "galeria" &&
              (carregandoDetalhes ? (
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <Loader2 size={14} className="animate-spin" />
                  Carregando galeria...
                </div>
              ) : galeriaProjeto.length === 0 ? (
                <p className="text-sm text-white/55">Este projeto não possui imagens na galeria.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {galeriaProjeto.map((imagem, indice) => (
                    <a
                      key={`${imagem.url}_${indice}`}
                      href={imagem.raw_url || imagem.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-xl border border-white/10 bg-black/30"
                    >
                      <img
                        src={imagem.url}
                        alt={imagem.title || `Imagem ${indice + 1}`}
                        className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                      {(imagem.title || imagem.description) && (
                        <div className="space-y-1 border-t border-white/10 p-3">
                          {imagem.title && (
                            <p className="text-xs font-bold text-white/90">{imagem.title}</p>
                          )}
                          {imagem.description && (
                            <p className="text-xs text-white/60">{imagem.description}</p>
                          )}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              ))}
          </div>

          <aside className="h-fit space-y-3 border border-white/10 bg-black/20 p-4">
            <h3 className="text-xs font-black uppercase tracking-wide text-white/70">
              Instalação
            </h3>

            {projeto.project_type === "modpack" ? (
              <div className="text-xs text-white/75 space-y-1">
                {projeto.source === "curseforge" ? (
                  <p className="text-orange-200">
                    Instalação automática de modpacks CurseForge ainda não está disponível.
                  </p>
                ) : (
                  <>
                    <p>O launcher criará uma nova instância automaticamente.</p>
                    {versaoModpackIdeal && (
                      <>
                        <p>Versão ideal: {versaoModpackIdeal.version_number}</p>
                        <p>
                          MC: {escolherVersaoMinecraftIdeal(versaoModpackIdeal.game_versions || [])}
                        </p>
                      </>
                    )}
                    {!usuarioLogado && <p className="text-orange-200">Faça login para instalar.</p>}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-white/65">Escolha a instância:</p>
                {compatibilidades.map((item) => {
                  const compativel =
                    projeto.source === "curseforge" || Boolean(item.versaoIdeal && item.arquivoIdeal);
                  const selecionada = instanciaSelecionadaId === item.instancia.id;
                  return (
                    <button
                      key={item.instancia.id}
                      onClick={() => setInstanciaSelecionadaId(item.instancia.id)}
                      className={cn(
                        "w-full border px-3 py-2 text-left",
                        selecionada
                          ? "border-emerald-400/45 bg-emerald-500/10"
                          : "border-white/10 bg-white/5",
                        !compativel && "opacity-70"
                      )}
                    >
                      <p className="truncate text-xs font-bold">{item.instancia.name}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/45">
                        <Gamepad2 size={10} />
                        {labelLoader(item.instancia)} {item.instancia.version}
                      </p>
                      {!compativel && (
                        <p className="mt-1 text-[11px] text-orange-200">
                          {item.motivoIncompatibilidade}
                        </p>
                      )}
                    </button>
                  );
                })}
                {compatibilidades.length === 0 && (
                  <p className="text-xs text-white/45">Nenhuma instância disponível no launcher.</p>
                )}
              </div>
            )}

            {erro && <p className="text-xs text-red-300">{erro}</p>}

            <button
              onClick={() => window.open(montarUrlProjeto(projetoExibicao), "_blank")}
              className="inline-flex items-center gap-2 border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/10"
            >
              <ExternalLink size={12} />
              Ver no site
            </button>
          </aside>
        </div>
      </section>
    </div>
  );
}
