import { useState, useEffect } from "react";
import {
  Heart,
  Package,
  Image,
  Sparkles,
  Trash2,
  ExternalLink,
  Download,
} from "../iconesPixelados";
import { motion, AnimatePresence } from "framer-motion";
import type { ProjetoConteudo } from "./ProjetoDetalheModal";

export interface FavoriteItem {
  id: string;
  title: string;
  description: string;
  icon_url: string;
  author: string;
  type: "mod" | "modpack" | "resourcepack" | "shader";
  source: "modrinth" | "curseforge";
  slug: string;
}

const STORAGE_KEY = "dome_favorites";

export function loadFavorites(): FavoriteItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(favorites: FavoriteItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export function addFavorite(item: FavoriteItem) {
  const favorites = loadFavorites();
  if (!favorites.find((f) => f.id === item.id)) {
    favorites.push(item);
    saveFavorites(favorites);
  }
}

export function removeFavorite(id: string) {
  const favorites = loadFavorites().filter((f) => f.id !== id);
  saveFavorites(favorites);
}

export function isFavorite(id: string): boolean {
  return loadFavorites().some((f) => f.id === id);
}

const TYPE_ICONS = {
  mod: Package,
  modpack: Package,
  resourcepack: Image,
  shader: Sparkles,
};

const TYPE_LABELS = {
  mod: "Mod",
  modpack: "Modpack",
  resourcepack: "Resource Pack",
  shader: "Shader",
};

interface FavoritesProps {
  onAbrirProjeto: (projeto: ProjetoConteudo) => void;
}

export default function Favorites({ onAbrirProjeto }: FavoritesProps) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  const handleRemove = (id: string) => {
    removeFavorite(id);
    setFavorites(loadFavorites());
  };

  const openProject = (item: FavoriteItem) => {
    const url =
      item.source === "modrinth"
        ? `https://modrinth.com/${item.type}/${item.slug}`
        : item.type === "modpack"
          ? `https://www.curseforge.com/minecraft/modpacks/${item.slug}`
          : item.type === "resourcepack"
            ? `https://www.curseforge.com/minecraft/texture-packs/${item.slug}`
            : item.type === "shader"
              ? `https://www.curseforge.com/minecraft/shaders/${item.slug}`
              : `https://www.curseforge.com/minecraft/mc-mods/${item.slug}`;
    window.open(url, "_blank");
  };

  const abrirDetalhes = (item: FavoriteItem) => {
    onAbrirProjeto({
      id: item.id,
      title: item.title,
      description: item.description,
      icon_url: item.icon_url,
      author: item.author,
      source: item.source,
      slug: item.slug,
      project_type: item.type,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-pink-500/10 rounded-2xl border border-pink-500/20">
          <Heart className="text-pink-500" size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Favoritos</h1>
          <p className="text-white/40 text-sm">
            Seus mods, modpacks, resource packs e shaders favoritos
          </p>
        </div>
      </div>

      {favorites.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
          <Heart size={48} className="mx-auto mb-4 text-white/10" />
          <p className="text-white/40 font-bold">Nenhum favorito ainda</p>
          <p className="text-white/30 text-sm mt-1">
            Explore mods e modpacks e adicione aos favoritos
          </p>
        </div>
      ) : (
        <AnimatePresence>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {favorites.map((item) => {
              const TypeIcon = TYPE_ICONS[item.type] || Package;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white/3 border border-white/5 rounded-2xl p-4 group hover:border-white/10 transition-all"
                >
                  <div className="flex gap-4">
                    <img
                      src={item.icon_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${item.id}`}
                      alt={item.title}
                      className="w-14 h-14 rounded-xl bg-black/40 object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold truncate group-hover:text-emerald-400 transition-colors">
                        {item.title}
                      </h3>
                      <p className="text-xs text-white/40">por {item.author}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="bg-white/5 px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1">
                          <TypeIcon size={10} />
                          {TYPE_LABELS[item.type]}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            item.source === "modrinth"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-orange-500/10 text-orange-400"
                          }`}
                        >
                          {item.source}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-white/50 line-clamp-2 mt-3">
                    {item.description}
                  </p>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => abrirDetalhes(item)}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <Download size={14} />
                      Instalar
                    </button>
                    <button
                      onClick={() => openProject(item)}
                      className="px-3 bg-white/5 hover:bg-white/10 rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      onClick={() => handleRemove(item.id)}
                      className="p-2 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 rounded-xl transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
