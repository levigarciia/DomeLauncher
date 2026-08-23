use super::*;
use base64::Engine as _;

const LIMITE_ICONE_INSTANCIA_BYTES: usize = 1024 * 1024;

pub(crate) fn validar_icone_instancia(icone: &str) -> Result<(), String> {
    let dados_base64 = icone
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "A imagem da instância deve estar no formato PNG.".to_string())?;
    let dados = base64::engine::general_purpose::STANDARD
        .decode(dados_base64)
        .map_err(|_| "A imagem da instância é inválida.".to_string())?;
    if !dados.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("O conteúdo da imagem da instância não é um PNG válido.".to_string());
    }
    if dados.len() > LIMITE_ICONE_INSTANCIA_BYTES {
        return Err("A imagem processada deve ter no máximo 1 MB.".to_string());
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn get_minecraft_versions() -> Result<VersionManifest, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let manifest = res
        .json::<VersionManifest>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(manifest)
}

#[tauri::command]
pub(crate) fn get_instances(state: State<LauncherState>) -> Result<Vec<Instance>, String> {
    state.get_instances().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn delete_instance(
    state: State<'_, LauncherState>,
    id: String,
) -> Result<(), String> {
    let instance_path = caminho_instancia_por_id(&state, &id)?;
    if instance_path.exists() {
        std::fs::remove_dir_all(instance_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn abrir_pasta_instancia(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<(), String> {
    let caminho = caminho_instancia_por_id(&state, &instance_id)?;
    if !caminho.is_dir() {
        return Err(format!(
            "A pasta da instância '{}' não existe.",
            instance_id
        ));
    }

    open::that(caminho).map_err(|e| format!("Erro ao abrir pasta da instância: {}", e))
}

#[tauri::command]
pub(crate) fn open_browser(url: String) -> Result<(), String> {
    let url = url::Url::parse(url.trim()).map_err(|_| "URL inválida.".to_string())?;
    if url.scheme() != "https" {
        return Err("Apenas endereços HTTPS podem ser abertos.".to_string());
    }

    open::that(url.as_str()).map_err(|e| e.to_string())
}

// ===== COMANDOS PARA GERENCIAMENTO DE MODS =====

// Funções antigas removidas - funcionalidades implementadas diretamente no código

// ===== COMANDOS PARA GERENCIAMENTO DE INSTÂNCIAS =====

#[tauri::command]
pub(crate) async fn get_instance_details(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<Instance, String> {
    state
        .get_instances()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|instancia| instancia.id == instance_id)
        .ok_or_else(|| format!("Instância '{}' não encontrada", instance_id))
}

#[tauri::command]
pub(crate) async fn update_instance_name(
    state: State<'_, LauncherState>,
    instance_id: String,
    new_name: String,
) -> Result<(), String> {
    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

    instance.name = new_name;

    let new_content = serde_json::to_string_pretty(&instance)
        .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;

    std::fs::write(&config_path, new_content)
        .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn update_instance_icon(
    state: State<'_, LauncherState>,
    instance_id: String,
    icon: String,
) -> Result<(), String> {
    validar_icone_instancia(&icon)?;
    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;
    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;
    instance.icon = Some(icon);

    let new_content = serde_json::to_string_pretty(&instance)
        .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;
    std::fs::write(&config_path, new_content)
        .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_instance_settings(
    state: State<'_, LauncherState>,
    instance_id: String,
    memory: Option<u32>,
    usar_memoria_personalizada: Option<bool>,
    java_args: Option<String>,
    usar_argumentos_jvm_personalizados: Option<bool>,
    mc_args: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

    if let Some(usar_memoria) = usar_memoria_personalizada {
        if usar_memoria {
            let memoria = memory.ok_or(
                "Informe a memória da instância ao ativar a alocação personalizada.".to_string(),
            )?;
            if !(512..=65536).contains(&memoria) {
                return Err("Memória da instância deve estar entre 512 e 65536 MB.".to_string());
            }
            instance.memory = Some(memoria);
        } else {
            instance.memory = None;
        }
    }

    if let Some(usar_argumentos) = usar_argumentos_jvm_personalizados {
        instance.java_args = if usar_argumentos {
            Some(java_args.unwrap_or_default().trim().to_string())
        } else {
            None
        };
    } else if let Some(java_args_valor) = java_args {
        let texto = java_args_valor.trim();
        instance.java_args = if texto.is_empty() {
            None
        } else {
            Some(texto.to_string())
        };
    }

    if let Some(mc_args_valor) = mc_args {
        let texto = mc_args_valor.trim();
        instance.mc_args = if texto.is_empty() {
            None
        } else {
            Some(texto.to_string())
        };
    }

    if let Some(largura) = width {
        if !(320..=7680).contains(&largura) {
            return Err("Largura da janela deve estar entre 320 e 7680.".to_string());
        }
        instance.width = Some(largura);
    }

    if let Some(altura) = height {
        if !(240..=4320).contains(&altura) {
            return Err("Altura da janela deve estar entre 240 e 4320.".to_string());
        }
        instance.height = Some(altura);
    }

    let new_content = serde_json::to_string_pretty(&instance)
        .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;

    std::fs::write(&config_path, new_content)
        .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;

    Ok(())
}

const ARQUIVOS_CENTRAIS_MIGRACAO: [&str; 5] = [
    "version_manifest.json",
    "bin/client.jar",
    "forge_manifest.json",
    "fabric_manifest.json",
    "neoforge_manifest.json",
];

#[tauri::command]
pub(crate) async fn update_instance_version(
    state: State<'_, LauncherState>,
    instance_id: String,
    minecraft_version: String,
    loader_version: Option<String>,
) -> Result<(), String> {
    let minecraft_version = minecraft_version.trim();
    if minecraft_version.is_empty() {
        return Err("Selecione uma versão do Minecraft.".to_string());
    }

    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    let config_path = instance_path.join("instance.json");
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;
    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao interpretar instance.json: {}", e))?;

    if instance.sessao_iniciada_em.is_some() {
        return Err("Feche o Minecraft antes de trocar a versão da instância.".to_string());
    }

    let loader = detectar_loader_normalizado(Some(
        instance
            .loader_type
            .as_deref()
            .filter(|valor| !valor.trim().is_empty())
            .unwrap_or(instance.mc_type.as_str()),
    ));
    let loader_version = validar_versao_loader_migracao(
        loader.as_deref(),
        minecraft_version,
        loader_version.as_deref(),
    )
    .await?;

    if instance.version == minecraft_version && instance.loader_version == loader_version {
        return Ok(());
    }

    let details = buscar_detalhes_versao_minecraft(minecraft_version).await?;
    let backup_dir = criar_backup_migracao(&instance_path)?;
    let resultado = aplicar_migracao_instancia(
        &instance_path,
        &mut instance,
        &details,
        loader.as_deref(),
        loader_version.as_deref(),
    )
    .await;

    if let Err(erro) = resultado {
        restaurar_backup_migracao(&instance_path, &backup_dir)?;
        let _ = std::fs::remove_dir_all(&backup_dir);
        return Err(erro);
    }

    let novo_conteudo = serde_json::to_string_pretty(&instance)
        .map_err(|e| format!("Erro ao serializar a instância atualizada: {}", e))?;
    if let Err(erro) = std::fs::write(&config_path, novo_conteudo) {
        restaurar_backup_migracao(&instance_path, &backup_dir)?;
        let _ = std::fs::remove_dir_all(&backup_dir);
        return Err(format!(
            "Erro ao salvar a nova versão da instância: {}",
            erro
        ));
    }

    let _ = std::fs::remove_dir_all(backup_dir);
    Ok(())
}

async fn validar_versao_loader_migracao(
    loader: Option<&str>,
    minecraft_version: &str,
    loader_version: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(loader) = loader.filter(|valor| *valor != "vanilla") else {
        return Ok(None);
    };
    if !matches!(loader, "forge" | "fabric" | "neoforge") {
        return Err(format!(
            "Troca de versão ainda não é suportada para o loader '{}'.",
            loader
        ));
    }

    let loader_version = loader_version
        .map(str::trim)
        .filter(|valor| !valor.is_empty())
        .ok_or_else(|| format!("Selecione uma versão do {}.", loader))?;
    let disponiveis = super::instancias_criacao::get_loader_versions(
        loader.to_string(),
        Some(minecraft_version.to_string()),
    )
    .await?;
    if !disponiveis
        .versions
        .iter()
        .any(|versao| versao.version == loader_version)
    {
        return Err(format!(
            "A versão {} do {} não é compatível com Minecraft {}.",
            loader_version, loader, minecraft_version
        ));
    }

    Ok(Some(loader_version.to_string()))
}

async fn buscar_detalhes_versao_minecraft(
    minecraft_version: &str,
) -> Result<VersionDetail, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao preparar a consulta de versões: {}", e))?;
    let manifest = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar versões do Minecraft: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Erro ao buscar versões do Minecraft: {}", e))?
        .json::<VersionManifest>()
        .await
        .map_err(|e| format!("Resposta de versões do Minecraft inválida: {}", e))?;
    let versao = manifest
        .versions
        .iter()
        .find(|versao| versao.id == minecraft_version)
        .ok_or_else(|| {
            format!(
                "Versão do Minecraft '{}' não encontrada.",
                minecraft_version
            )
        })?;

    client
        .get(&versao.url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar detalhes do Minecraft: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Erro ao buscar detalhes do Minecraft: {}", e))?
        .json::<VersionDetail>()
        .await
        .map_err(|e| format!("Detalhes da versão do Minecraft inválidos: {}", e))
}

fn criar_backup_migracao(instance_path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let backup_dir = instance_path.join(format!(".dome-migration-backup-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Erro ao preparar backup da migração: {}", e))?;

    for arquivo in ARQUIVOS_CENTRAIS_MIGRACAO {
        let origem = instance_path.join(arquivo);
        if !origem.exists() {
            continue;
        }
        let destino = backup_dir.join(arquivo);
        if let Some(parent) = destino.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Erro ao preparar backup da migração: {}", e))?;
        }
        std::fs::copy(&origem, &destino)
            .map_err(|e| format!("Erro ao copiar backup de '{}': {}", arquivo, e))?;
    }

    Ok(backup_dir)
}

fn restaurar_backup_migracao(
    instance_path: &std::path::Path,
    backup_dir: &std::path::Path,
) -> Result<(), String> {
    for arquivo in ARQUIVOS_CENTRAIS_MIGRACAO {
        let backup = backup_dir.join(arquivo);
        let destino = instance_path.join(arquivo);
        if backup.exists() {
            if let Some(parent) = destino.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Erro ao restaurar a migração: {}", e))?;
            }
            std::fs::copy(&backup, &destino)
                .map_err(|e| format!("Erro ao restaurar '{}': {}", arquivo, e))?;
        } else if destino.exists() {
            std::fs::remove_file(&destino)
                .map_err(|e| format!("Erro ao remover arquivo parcial '{}': {}", arquivo, e))?;
        }
    }
    Ok(())
}

async fn aplicar_migracao_instancia(
    instance_path: &std::path::Path,
    instance: &mut Instance,
    details: &VersionDetail,
    loader: Option<&str>,
    loader_version: Option<&str>,
) -> Result<(), String> {
    for manifesto in [
        "forge_manifest.json",
        "fabric_manifest.json",
        "neoforge_manifest.json",
    ] {
        let caminho = instance_path.join(manifesto);
        if caminho.exists() {
            std::fs::remove_file(&caminho)
                .map_err(|e| format!("Erro ao substituir o perfil do loader: {}", e))?;
        }
    }

    let manifest_content = serde_json::to_string_pretty(details)
        .map_err(|e| format!("Erro ao preparar manifesto do Minecraft: {}", e))?;
    std::fs::write(
        instance_path.join("version_manifest.json"),
        manifest_content,
    )
    .map_err(|e| format!("Erro ao salvar manifesto do Minecraft: {}", e))?;
    super::instancias_criacao::download_instance_files(instance_path, details).await?;

    match (loader, loader_version) {
        (Some("forge"), Some(versao)) => {
            super::instancias_criacao::install_forge_loader(instance_path, &details.id, versao)
                .await?;
        }
        (Some("fabric"), Some(versao)) => {
            super::instancias_criacao::install_fabric_loader(instance_path, &details.id, versao)
                .await?;
        }
        (Some("neoforge"), Some(versao)) => {
            super::instancias_criacao::install_neoforge_loader(instance_path, &details.id, versao)
                .await?;
        }
        (None | Some("vanilla"), None) => {}
        _ => return Err("Configuração de loader incompleta para a migração.".to_string()),
    }

    instance.version = details.id.clone();
    instance.loader_version = loader_version.map(str::to_string);
    Ok(())
}

pub(super) fn normalizar_nome_pasta_instancia(nome: &str) -> String {
    let mut resultado = String::new();
    let mut ultimo_foi_separador = false;

    for caractere in nome.trim().to_lowercase().chars() {
        let permitido = caractere.is_alphanumeric() || matches!(caractere, '-' | '_');
        if permitido {
            resultado.push(caractere);
            ultimo_foi_separador = false;
            continue;
        }

        if !ultimo_foi_separador {
            resultado.push('_');
            ultimo_foi_separador = true;
        }
    }

    let resultado = resultado
        .trim_matches(['.', '_'])
        .chars()
        .take(80)
        .collect::<String>();
    let nomes_reservados = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];

    if nomes_reservados.contains(&resultado.as_str()) {
        return format!("{}_instancia", resultado);
    }

    resultado
}

#[tauri::command]
pub(crate) async fn rename_instance_folder(
    state: State<'_, LauncherState>,
    instance_id: String,
    new_folder_name: String,
) -> Result<String, String> {
    let id_base = normalizar_nome_pasta_instancia(&new_folder_name);
    if id_base.is_empty() {
        return Err("Nome da pasta não pode ser vazio".to_string());
    }

    let pasta_atual = caminho_instancia_por_id(&state, &instance_id)?;
    if !pasta_atual.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    if instance_id == id_base {
        return Ok(instance_id);
    }

    let mut novo_id = id_base.clone();
    let mut contador = 2;
    let pasta_nova = loop {
        let candidata = caminho_instancia_por_id(&state, &novo_id)?;
        if !candidata.exists() {
            break candidata;
        }
        novo_id = format!("{}_{}", id_base, contador);
        contador += 1;
    };

    std::fs::rename(&pasta_atual, &pasta_nova)
        .map_err(|e| format!("Erro ao renomear pasta da instância: {}", e))?;

    let config_path = pasta_nova.join("instance.json");
    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

        let mut instance: Instance = serde_json::from_str(&content)
            .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

        instance.id = novo_id.clone();
        instance.path = pasta_nova.clone();

        let new_content = serde_json::to_string_pretty(&instance)
            .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;

        std::fs::write(&config_path, new_content)
            .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;
    }

    Ok(novo_id)
}

#[cfg(test)]
mod testes {
    use super::{normalizar_nome_pasta_instancia, validar_icone_instancia};

    #[test]
    fn adapta_caracteres_invalidos_para_nome_de_pasta() {
        assert_eq!(
            normalizar_nome_pasta_instancia("Meu Modpack: 1.21?"),
            "meu_modpack_1_21"
        );
        assert_eq!(normalizar_nome_pasta_instancia("CON"), "con_instancia");
        assert_eq!(
            normalizar_nome_pasta_instancia("  Wynncraft  "),
            "wynncraft"
        );
    }

    #[test]
    fn valida_icone_png_embutido() {
        let png_um_pixel = "data:image/png;base64,\
            iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        assert!(validar_icone_instancia(png_um_pixel).is_ok());
        assert!(validar_icone_instancia("data:image/jpeg;base64,/9j/4AAQ").is_err());
        assert!(validar_icone_instancia("data:image/png;base64,AAAA").is_err());
    }
}

#[tauri::command]
pub(crate) fn reiniciar_aplicativo(app: tauri::AppHandle) {
    app.restart();
}
