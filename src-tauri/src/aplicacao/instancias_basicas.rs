use super::*;

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
pub(crate) async fn delete_instance(state: State<'_, LauncherState>, id: String) -> Result<(), String> {
    let instance_path = state.instances_path.join(&id);
    if instance_path.exists() {
        std::fs::remove_dir_all(instance_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn open_browser(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
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
    let instance_path = state.instances_path.join(&instance_id);
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
pub(crate) async fn update_instance_settings(
    state: State<'_, LauncherState>,
    instance_id: String,
    memory: Option<u32>,
    java_args: Option<String>,
    mc_args: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    let instance_path = state.instances_path.join(&instance_id);
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

    if let Some(memoria) = memory {
        if !(512..=65536).contains(&memoria) {
            return Err("Memória da instância deve estar entre 512 e 65536 MB.".to_string());
        }
        instance.memory = Some(memoria);
    }

    if let Some(java_args_valor) = java_args {
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

pub(super) fn normalizar_nome_pasta_instancia(nome: &str) -> String {
    urlencoding::encode(&nome.trim().to_lowercase().replace(' ', "_")).to_string()
}

#[tauri::command]
pub(crate) async fn rename_instance_folder(
    state: State<'_, LauncherState>,
    instance_id: String,
    new_folder_name: String,
) -> Result<String, String> {
    let novo_id = normalizar_nome_pasta_instancia(&new_folder_name);
    if novo_id.is_empty() {
        return Err("Nome da pasta não pode ser vazio".to_string());
    }

    let pasta_atual = state.instances_path.join(&instance_id);
    if !pasta_atual.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    if instance_id == novo_id {
        return Ok(instance_id);
    }

    let pasta_nova = state.instances_path.join(&novo_id);
    if pasta_nova.exists() {
        return Err(format!("Já existe uma instância com pasta '{}'", novo_id));
    }

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

#[tauri::command]
pub(crate) fn reiniciar_aplicativo(app: tauri::AppHandle) {
    app.restart();
}
