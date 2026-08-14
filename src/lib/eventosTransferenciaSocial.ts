export const EVENTO_SOLICITAR_TRANSFERENCIA_SOCIAL = "dome:social-solicitar-sync";
export const EVENTO_PROGRESSO_TRANSFERENCIA_SOCIAL = "dome:social-transferencia-progresso";
export const EVENTO_INSTANCIAS_ATUALIZADAS = "dome:instancias-atualizadas";

export type EstadoTransferenciaSocial =
    | "solicitando"
    | "aguardando"
    | "preparando"
    | "importando"
    | "concluido"
    | "erro";

export interface ProgressoTransferenciaSocial {
    estado: EstadoTransferenciaSocial;
    mensagem: string;
    friendProfileId: string;
    pedidoId?: string;
    instanciaId?: string | null;
}

export function publicarProgressoTransferenciaSocial(progresso: ProgressoTransferenciaSocial) {
    window.dispatchEvent(new CustomEvent(EVENTO_PROGRESSO_TRANSFERENCIA_SOCIAL, {
        detail: progresso,
    }));
}
