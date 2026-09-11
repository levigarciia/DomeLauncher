# Downloads de instâncias

O módulo `src-tauri/src/aplicacao/downloads_instancias.rs` prepara cliente, bibliotecas e assets
para criação, importação e lançamento. O cliente e as bibliotecas são baixados enquanto o índice
de assets é obtido e seus objetos são preparados, com até 32 transferências simultâneas no processo.

Os downloads ficam em `%APPDATA%/dome/cache/arquivos-minecraft`, identificados pelo SHA-1 do manifesto.
Arquivos sem hash usam a URL como chave. Requisições simultâneas pelo mesmo conteúdo compartilham o
download, e assets duplicados no índice são processados apenas uma vez por destino.

O cache é validado por tamanho e SHA-1, quando fornecidos, antes da reutilização. Cada instância
recebe uma cópia independente; não há hardlinks que possam propagar alterações entre instâncias.
Gravações usam arquivos temporários no diretório de destino e renomeação após conclusão. Erros HTTP,
de integridade ou de disco são retornados ao chamador, sem registrar sucesso parcial.

Arquivos já presentes na instância são conferidos por tamanho quando disponível. Essa verificação
evita reler todos os assets a cada lançamento; não equivale a uma auditoria completa de integridade.
Instâncias antigas não são percorridas para preencher o cache. O cache é alimentado pelos novos
downloads e pode ser apagado quando não houver instalações em andamento, sem afetar as instâncias.
Não há expiração automática, e o cache ocupa espaço adicional em disco.

O log `[Instância] Arquivos preparados em ...` mede a etapa de preparação. A instalação dos loaders
Forge/NeoForge continua dependendo do instalador externo e ocorre depois dessa etapa.

Os testes locais usam HTTP controlado para verificar concorrência, reutilização offline, isolamento
das cópias, erros HTTP, integridade e recuperação de truncamento. Seus tempos não representam uma
instalação real: a comparação com Minecraft e loaders deve ser feita no aplicativo, com cache vazio
e depois preenchido, usando a mesma versão e conexão.
