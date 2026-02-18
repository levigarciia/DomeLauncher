import { useState, useEffect, useRef } from "react";
import {
  Search,
  Download,
  Star,
  Heart,
  Package,
  Image,
  Sparkles,
  Loader2,
} from "../iconesPixelados";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { addFavorite, removeFavorite, isFavorite, type FavoriteItem } from "./Favorites";
import type { ProjetoConteudo, TipoProjetoConteudo } from "./ProjetoDetalheModal";
import { invoke } from "@tauri-apps/api/core";

type ContentType = "modpack" | "mod" | "resourcepack" | "shader";
type Source = "modrinth" | "curseforge";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  downloads?: number;
  follows?: number;
  project_type: TipoProjetoConteudo;
  slug: string;
}

const CONTENT_TYPES = [
  { id: "modpack" as ContentType, label: "Modpacks", icon: Package },
  { id: "mod" as ContentType, label: "Mods", icon: Package },
  { id: "resourcepack" as ContentType, label: "Textures", icon: Image },
  { id: "shader" as ContentType, label: "Shaders", icon: Sparkles },
];

interface ExploreProps {
  onAtualizarPresencaExplore?: (contexto: {
    tipo: ContentType;
    fonte: Source;
    titulo?: string;
  }) => void;
  onAbrirProjeto: (projeto: ProjetoConteudo) => void;
}

export default function Explore({
  onAtualizarPresencaExplore,
  onAbrirProjeto,
}: ExploreProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<Source>("modrinth");
  const [contentType, setContentType] = useState<ContentType>("modpack");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const hasLoaded = useRef(false);
  const lastSearch = useRef({ query: "", contentType: "", source: "" });

  useEffect(() => {
    const favIds = new Set<string>();
    results.forEach((resultado) => {
      if (isFavorite(resultado.id)) favIds.add(resultado.id);
    });
    setFavorites(favIds);
  }, [results]);

  const searchContent = async (q: string, type: ContentType, src: Source) => {
    if (
      lastSearch.current.query === q &&
      lastSearch.current.contentType === type &&
      lastSearch.current.source === src
    ) {
      return;
    }
    lastSearch.current = { query: q, contentType: type, source: src };

    setLoading(true);
    try {
      const resultados: any[] = await invoke("search_mods_online", {
        query: q,
        platform: src,
        contentType: type,
      });

      setResults(
        resultados.map((item: any) => ({
          id: String(item.id || ""),
          title: String(item.name || item.title || "Sem nome"),
          description: String(item.description || ""),
          icon_url: item.iconUrl || item.icon_url || undefined,
          author: String(item.author || "Desconhecido"),
          downloads:
            typeof item.downloadCount === "number"
              ? item.downloadCount
              : typeof item.download_count === "number"
                ? item.download_count
                : undefined,
          follows:
            typeof item.follows === "number"
              ? item.follows
              : undefined,
          project_type: (item.projectType || item.project_type || type) as TipoProjetoConteudo,
          slug:
            String(item.slug || "").trim() ||
            String(item.id || "").trim(),
        }))
      );
    } catch (error) {
      console.error("Erro ao buscar:", error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      searchContent("", contentType, source);
    }
  }, []);

  useEffect(() => {
    if (hasLoaded.current) {
      searchContent(query, contentType, source);
    }
  }, [contentType, source]);

  useEffect(() => {
    if (!hasLoaded.current) return;
    const timer = setTimeout(() => {
      searchContent(query, contentType, source);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    onAtualizarPresencaExplore?.({
      tipo: contentType,
      fonte: source,
    });
  }, [contentType, source, onAtualizarPresencaExplore]);

  const toggleFavorite = (item: SearchResult) => {
    if (favorites.has(item.id)) {
      removeFavorite(item.id);
      setFavorites((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } else {
      const favItem: FavoriteItem = {
        id: item.id,
        title: item.title,
        description: item.description,
        icon_url: item.icon_url || "",
        author: item.author,
        type: contentType,
        source,
        slug: item.slug,
      };
      addFavorite(favItem);
      setFavorites((prev) => new Set(prev).add(item.id));
    }
  };

  const abrirDetalheProjeto = (item: SearchResult) => {
    onAbrirProjeto({
      ...item,
      icon_url: item.icon_url || "",
      source,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={20} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar modpacks, mods, textures, shaders..."
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            {CONTENT_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setContentType(type.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                  contentType === type.id
                    ? "bg-emerald-500 text-black"
                    : "text-white/40 hover:text-white"
                )}
              >
                <type.icon size={14} />
                {type.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setSource("modrinth")}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                source === "modrinth" ? "bg-emerald-500 text-black" : "text-white/40 hover:text-white"
              )}
            >
              Modrinth
            </button>
            <button
              onClick={() => setSource("curseforge")}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-all border",
                source === "curseforge"
                  ? "bg-[#f16436] text-white border-[#f16436]"
                  : "text-white/40 hover:text-white border-transparent hover:bg-white/5"
              )}
            >
              CurseForge
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-emerald-500" size={40} />
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {results.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className="bg-white/5 border border-white/5 hover:border-white/20 rounded-3xl p-5 transition-all group flex flex-col gap-4 cursor-pointer"
              onClick={() => abrirDetalheProjeto(item)}
              onMouseEnter={() =>
                onAtualizarPresencaExplore?.({
                  tipo: item.project_type as ContentType,
                  fonte: source,
                  titulo: item.title,
                })
              }
              onMouseLeave={() =>
                onAtualizarPresencaExplore?.({
                  tipo: contentType,
                  fonte: source,
                })
              }
            >
              <div className="flex gap-4">
                <img
                  src={item.icon_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${item.id}`}
                  alt={item.title}
                  className="w-16 h-16 rounded-2xl bg-black/40 object-cover"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg truncate group-hover:text-emerald-400 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-xs text-white/40 mb-2 items-center flex gap-1">
                    por <span className="text-white/60 font-medium">{item.author}</span>
                  </p>
                  <div className="flex gap-2">
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase">
                      {item.project_type}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-white/60 line-clamp-3 leading-relaxed">
                {item.description}
              </p>

              <div className="mt-auto pt-4 flex items-center justify-between border-t border-white/5">
                <div className="flex gap-4 text-white/40">
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    <Download size={12} />
                    {(() => {
                      const qtdDownloads = item.downloads || 0;
                      if (qtdDownloads >= 1000000) return `${(qtdDownloads / 1000000).toFixed(1)}M`;
                      if (qtdDownloads >= 1000) return `${(qtdDownloads / 1000).toFixed(1)}K`;
                      return qtdDownloads;
                    })()}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    <Star size={12} className="text-yellow-500/50" />
                    {(() => {
                      const qtdSeguidores = item.follows || 0;
                      return qtdSeguidores >= 1000
                        ? `${(qtdSeguidores / 1000).toFixed(1)}K`
                        : qtdSeguidores;
                    })()}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(item);
                    }}
                    className={cn(
                      "p-2 rounded-xl transition-all",
                      favorites.has(item.id)
                        ? "bg-pink-500/20 text-pink-400"
                        : "bg-white/5 hover:bg-white/10 text-white/40"
                    )}
                  >
                    <Heart size={16} fill={favorites.has(item.id) ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      abrirDetalheProjeto(item);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black"
                  >
                    <Download size={14} />
                    Instalar
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
