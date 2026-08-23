export const EVENTO_NAVEGACAO_MOUSE_LATERAL = "dome:navegacao-mouse-lateral";

export type DirecaoNavegacaoMouseLateral = -1 | 1;

export interface DetalheNavegacaoMouseLateral {
  direcao: DirecaoNavegacaoMouseLateral;
}

export const solicitarNavegacaoMouseLateral = (
    direcao: DirecaoNavegacaoMouseLateral
): boolean => {
    const evento = new CustomEvent<DetalheNavegacaoMouseLateral>(
        EVENTO_NAVEGACAO_MOUSE_LATERAL,
        {
            detail: { direcao },
            cancelable: true,
        }
    );

    return !window.dispatchEvent(evento);
};
