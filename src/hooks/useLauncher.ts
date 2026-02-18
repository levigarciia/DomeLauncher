import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface Instance {
  id: string;
  name: string;
  version: string;
  mc_type: string;
  loader_type?: string;
  icon?: string;
  last_played?: string;
  path: string;
}

export interface MinecraftAccount {
  uuid: string;
  name: string;
  access_token: string;
}

interface ConfiguracoesGlobais {
  close_on_launch?: boolean;
}

export function useLauncher() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [account, setAccount] = useState<MinecraftAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInstances = async () => {
    try {
      const data = await invoke<Instance[]>("get_instances");
      const normalizadas = (data as any[]).map((inst) => ({
        ...inst,
        mc_type: inst.mc_type ?? inst.mcType,
        loader_type: inst.loader_type ?? inst.loaderType,
        last_played: inst.last_played ?? inst.lastPlayed,
      })) as Instance[];
      setInstances(normalizadas);
    } catch (error) {
      console.error("Erro ao buscar instâncias:", error);
    }
  };

  const refreshAccount = async () => {
    try {
      const acc = await invoke<MinecraftAccount | null>("check_auth_status");
      setAccount(acc);
    } catch (error) {
      console.error("Erro ao verificar conta:", error);
    }
  };

  const aplicarComportamentoLauncherAoIniciar = async () => {
    try {
      const configuracoes = await invoke<ConfiguracoesGlobais>("get_settings");
      if (configuracoes?.close_on_launch) {
        await getCurrentWindow().minimize();
      }
    } catch (erro) {
      console.warn("Falha ao aplicar close_on_launch:", erro);
    }
  };

  const launch = async (id: string) => {
    try {
      await invoke("launch_instance", { id });
      await aplicarComportamentoLauncherAoIniciar();
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao iniciar Minecraft:", error);
      alert(error);
    }
  };

  const launchServer = async (id: string, address: string) => {
    try {
      await invoke("launch_instance_to_server", { id, address });
      await aplicarComportamentoLauncherAoIniciar();
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao iniciar servidor via quick play:", error);
      alert(error);
    }
  };

  const remove = async (id: string) => {
    try {
      await invoke("delete_instance", { id });
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao deletar instância:", error);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchInstances(), refreshAccount()]);
      setLoading(false);
    };
    init();
  }, []);

  return {
    instances,
    account,
    loading,
    fetchInstances,
    refreshAccount,
    launch,
    launchServer,
    remove,
  };
}
