import { useState, useEffect, useCallback } from "react";
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
  tempo_total_jogado_segundos?: number;
  sessao_iniciada_em?: string;
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

  const fetchInstances = useCallback(async () => {
    try {
      const data = await invoke<Instance[]>("get_instances");
      const normalizadas = (data as any[]).map((inst) => ({
        ...inst,
        mc_type: inst.mc_type ?? inst.mcType,
        loader_type: inst.loader_type ?? inst.loaderType,
        last_played: inst.last_played ?? inst.lastPlayed,
        tempo_total_jogado_segundos:
          inst.tempo_total_jogado_segundos ??
          inst.tempoTotalJogadoSegundos ??
          inst.total_playtime_seconds ??
          inst.totalPlaytimeSeconds,
        sessao_iniciada_em:
          inst.sessao_iniciada_em ??
          inst.sessaoIniciadaEm ??
          inst.session_started_at ??
          inst.sessionStartedAt,
      })) as Instance[];
      setInstances(normalizadas);
    } catch (error) {
      console.error("Erro ao buscar instâncias:", error);
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const acc = await invoke<MinecraftAccount | null>("check_auth_status");
      setAccount(acc);
    } catch (error) {
      console.error("Erro ao verificar conta:", error);
    }
  }, []);

  const aplicarComportamentoLauncherAoIniciar = useCallback(async () => {
    try {
      const configuracoes = await invoke<ConfiguracoesGlobais>("get_settings");
      if (configuracoes?.close_on_launch) {
        await getCurrentWindow().minimize();
      }
    } catch (erro) {
      console.warn("Falha ao aplicar close_on_launch:", erro);
    }
  }, []);

  const launch = useCallback(async (id: string) => {
    try {
      await invoke("launch_instance", { id });
      await aplicarComportamentoLauncherAoIniciar();
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao iniciar Minecraft:", error);
      alert(error);
    }
  }, [aplicarComportamentoLauncherAoIniciar, fetchInstances]);

  const launchServer = useCallback(async (id: string, address: string) => {
    try {
      await invoke("launch_instance_to_server", { id, address });
      await aplicarComportamentoLauncherAoIniciar();
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao iniciar servidor via quick play:", error);
      alert(error);
    }
  }, [aplicarComportamentoLauncherAoIniciar, fetchInstances]);

  const remove = useCallback(async (id: string) => {
    try {
      await invoke("delete_instance", { id });
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao deletar instância:", error);
    }
  }, [fetchInstances]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchInstances(), refreshAccount()]);
      setLoading(false);
    };
    init();
  }, [fetchInstances, refreshAccount]);

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
