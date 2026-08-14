export interface InstanciaEmImportacao {
    idExterno: string;
    launcher: string;
    nome: string;
    versaoMinecraft: string;
    loaderType?: string;
    loaderVersion?: string;
    icone?: string;
    caminhoOrigem: string;
    caminhoJogo: string;
}

let instanciasEmImportacao: InstanciaEmImportacao[] = [];
let ouvintes: Array<() => void> = [];

function notificarOuvintes() {
    ouvintes.forEach((ouvinte) => ouvinte());
}

export function observarImportacoes(ouvinte: () => void) {
    ouvintes = [...ouvintes, ouvinte];
    return () => {
        ouvintes = ouvintes.filter((item) => item !== ouvinte);
    };
}

export function obterImportacoesEmAndamento(): InstanciaEmImportacao[] {
    return instanciasEmImportacao;
}

export function iniciarImportacoes(instancias: InstanciaEmImportacao[]) {
    instanciasEmImportacao = [...instancias];
    notificarOuvintes();
}

export function finalizarImportacoes() {
    instanciasEmImportacao = [];
    notificarOuvintes();
}
