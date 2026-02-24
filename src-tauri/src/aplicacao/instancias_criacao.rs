use super::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoaderVersionInfo {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LoaderVersionsResponse {
    pub versions: Vec<LoaderVersionInfo>,
}

/// Busca versões disponíveis dos loaders (Fabric, Forge, NeoForge)
#[tauri::command]
pub(crate) async fn get_loader_versions(loader_type: String) -> Result<LoaderVersionsResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;

    let versions = match loader_type.to_lowercase().as_str() {
        "fabric" => {
            // API do Fabric para versões do loader
            let url = "https://meta.fabricmc.net/v2/versions/loader";
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Erro ao buscar versões do Fabric: {}", e))?;

            if !response.status().is_success() {
                return Err(format!(
                    "API do Fabric retornou erro: {}",
                    response.status()
                ));
            }

            let fabric_versions: Vec<serde_json::Value> = response
                .json()
                .await
                .map_err(|e| format!("Erro ao parsear resposta do Fabric: {}", e))?;

            fabric_versions
                .iter()
                .filter_map(|v| {
                    let version = v["version"].as_str()?.to_string();
                    let stable = v["stable"].as_bool();
                    Some(LoaderVersionInfo { version, stable })
                })
                .collect::<Vec<_>>()
        }
        "forge" => {
            // API do Forge - usa o promotions endpoint para versões estáveis
            let url =
                "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Erro ao buscar versões do Forge: {}", e))?;

            if !response.status().is_success() {
                return Err(format!("API do Forge retornou erro: {}", response.status()));
            }

            let forge_data: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Erro ao parsear resposta do Forge: {}", e))?;

            // Extrair versões únicas do Forge
            let mut versions_set = std::collections::HashSet::new();
            if let Some(promos) = forge_data["promos"].as_object() {
                for (key, value) in promos {
                    // Formato: "1.20.1-latest" ou "1.20.1-recommended" -> valor é a build do Forge
                    if let Some(forge_version) = value.as_str() {
                        // Extrair versão do MC a partir da chave
                        if let Some(mc_version) = key.split('-').next() {
                            let full_version = format!("{}-{}", mc_version, forge_version);
                            versions_set.insert(full_version);
                        }
                    }
                }
            }

            let mut versions: Vec<LoaderVersionInfo> = versions_set
                .into_iter()
                .map(|v| LoaderVersionInfo {
                    version: v,
                    stable: Some(true),
                })
                .collect();

            // Ordenar por versão (mais recente primeiro)
            versions.sort_by(|a, b| b.version.cmp(&a.version));
            versions
        }
        "neoforge" => {
            // API do NeoForge para listar versões
            let url =
                "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Erro ao buscar versões do NeoForge: {}", e))?;

            if !response.status().is_success() {
                return Err(format!(
                    "API do NeoForge retornou erro: {}",
                    response.status()
                ));
            }

            let neoforge_data: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Erro ao parsear resposta do NeoForge: {}", e))?;

            // O endpoint retorna um array de versões
            if let Some(versions_arr) = neoforge_data["versions"].as_array() {
                versions_arr
                    .iter()
                    .filter_map(|v| {
                        let version = v.as_str()?.to_string();
                        Some(LoaderVersionInfo {
                            version,
                            stable: Some(true),
                        })
                    })
                    .rev() // Versões mais recentes primeiro
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            }
        }
        _ => {
            return Err(format!("Tipo de loader desconhecido: {}", loader_type));
        }
    };

    if versions.is_empty() {
        return Err(format!(
            "Nenhuma versão encontrada para o loader: {}",
            loader_type
        ));
    }

    Ok(LoaderVersionsResponse { versions })
}

// ===== FUNÇÕES DE MODS E CONTEÚDO =====


fn extrair_build_forge(minecraft_version: &str, forge_version: &str) -> String {
    let versao = forge_version.trim();
    if versao.is_empty() {
        return versao.to_string();
    }

    if let Some(restante) = versao.strip_prefix(&format!("{}-", minecraft_version)) {
        return restante.to_string();
    }

    if let Some((prefixo, restante)) = versao.split_once('-') {
        if prefixo.starts_with("1.") && !restante.trim().is_empty() {
            return restante.trim().to_string();
        }
    }

    versao.to_string()
}

fn versao_forge_completa(minecraft_version: &str, forge_version: &str) -> String {
    let versao = forge_version.trim();
    if versao.starts_with(&format!("{}-", minecraft_version)) {
        return versao.to_string();
    }

    let build = extrair_build_forge(minecraft_version, versao);
    format!("{}-{}", minecraft_version, build)
}

pub(super) async fn install_forge_loader(
    instance_path: &std::path::Path,
    minecraft_version: &str,
    forge_version: &str,
) -> Result<(), String> {
    let versao_forge = versao_forge_completa(minecraft_version, forge_version);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;
    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar",
        versao_forge, versao_forge
    );

    let temp_dir = std::env::temp_dir().join("dome_launcher_forge_installer");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let installer_path = temp_dir.join("forge-installer.jar");

    // Download do installer
    let response = client
        .get(&installer_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar instalador Forge: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Falha ao baixar instalador Forge ({}): {}",
            response.status(),
            installer_url
        ));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&installer_path, bytes).map_err(|e| e.to_string())?;

    // Executar installer. Para launcher cliente, tentamos installClient primeiro.
    let instalador_str = installer_path
        .to_str()
        .ok_or_else(|| "Caminho do instalador Forge inválido.".to_string())?;

    let mut tentativas: Vec<String> = Vec::new();
    for modo in ["--installClient", "--installServer"] {
        let output = std::process::Command::new("java")
            .args(["-jar", instalador_str, modo])
            .current_dir(instance_path)
            .output()
            .map_err(|e| format!("Erro ao executar instalador Forge: {}", e))?;

        if output.status.success() {
            // Limpar arquivos temporários
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detalhe = if !stderr.is_empty() { stderr } else { stdout };
        tentativas.push(format!("{} -> {}", modo, detalhe));
    }

    let _ = std::fs::remove_dir_all(temp_dir);
    Err(format!(
        "Falha ao instalar Forge (versão {}). {}",
        versao_forge,
        tentativas.join(" | ")
    ))
}

pub(super) async fn install_fabric_loader(
    instance_path: &std::path::Path,
    minecraft_version: &str,
    fabric_version: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    println!(
        "[Fabric] Instalando Fabric {} para MC {}",
        fabric_version, minecraft_version
    );

    // Usar a API Meta do Fabric para obter o perfil completo
    let profile_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        minecraft_version, fabric_version
    );

    println!("[Fabric] Buscando perfil: {}", profile_url);

    let response = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar perfil Fabric: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Falha ao obter perfil Fabric: {}",
            response.status()
        ));
    }

    let fabric_profile: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear perfil Fabric: {}", e))?;

    // Salvar o perfil do Fabric para uso posterior
    let fabric_manifest_path = instance_path.join("fabric_manifest.json");
    std::fs::write(
        &fabric_manifest_path,
        serde_json::to_string_pretty(&fabric_profile).unwrap(),
    )
    .map_err(|e| format!("Erro ao salvar manifesto Fabric: {}", e))?;

    // Baixar bibliotecas do Fabric
    let libraries_path = instance_path.join("libraries");
    std::fs::create_dir_all(&libraries_path).map_err(|e| e.to_string())?;

    if let Some(libs) = fabric_profile["libraries"].as_array() {
        println!("[Fabric] Baixando {} bibliotecas...", libs.len());

        for lib in libs {
            if let Some(name) = lib["name"].as_str() {
                // Formato Maven: group:artifact:version
                // Exemplo: net.fabricmc:fabric-loader:0.16.14
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    let group = parts[0].replace('.', "/");
                    let artifact = parts[1];
                    let version = parts[2];

                    // URL base (pode vir de lib["url"] ou usar Maven Central/Fabric Maven)
                    let base_url = lib["url"].as_str().unwrap_or("https://maven.fabricmc.net/");

                    let jar_path = format!(
                        "{}/{}/{}/{}-{}.jar",
                        group, artifact, version, artifact, version
                    );
                    let download_url = format!("{}{}", base_url, jar_path);

                    let local_path = libraries_path.join(&jar_path);

                    if !local_path.exists() {
                        // Criar diretório pai
                        if let Some(parent) = local_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }

                        println!("[Fabric] Baixando: {}", artifact);
                        match client.get(&download_url).send().await {
                            Ok(res) => {
                                if res.status().is_success() {
                                    if let Ok(bytes) = res.bytes().await {
                                        std::fs::write(&local_path, bytes).ok();
                                    }
                                } else {
                                    // Tentar Maven Central como fallback
                                    let maven_central_url =
                                        format!("https://repo1.maven.org/maven2/{}", jar_path);
                                    if let Ok(res2) = client.get(&maven_central_url).send().await {
                                        if res2.status().is_success() {
                                            if let Ok(bytes) = res2.bytes().await {
                                                std::fs::write(&local_path, bytes).ok();
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("[Fabric] Falha ao baixar {}: {}", artifact, e);
                            }
                        }
                    }
                }
            }
        }
    }

    println!("[Fabric] Instalação concluída!");
    Ok(())
}

pub(super) async fn install_neoforge_loader(
    instance_path: &std::path::Path,
    _minecraft_version: &str,
    neoforge_version: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let installer_url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
        neoforge_version, neoforge_version
    );

    let temp_dir = std::env::temp_dir().join("dome_launcher_neoforge_installer");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let installer_path = temp_dir.join("neoforge-installer.jar");

    // Download do installer
    let response = client
        .get(&installer_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&installer_path, bytes).map_err(|e| e.to_string())?;

    // Executar installer
    let output = std::process::Command::new("java")
        .args(&["-jar", installer_path.to_str().unwrap(), "--installServer"])
        .current_dir(instance_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("Falha ao instalar NeoForge".to_string());
    }

    // Limpar arquivos temporários
    let _ = std::fs::remove_dir_all(temp_dir);

    Ok(())
}

#[tauri::command]
pub(crate) async fn create_instance(
    state: State<'_, LauncherState>,
    name: String,
    version: String,
    mc_type: String,
    loader_type: Option<String>,
    loader_version: Option<String>,
) -> Result<(), String> {
    println!("=== INICIANDO CRIAÇÃO DE INSTÂNCIA ===");
    println!("Nome: {}, Versão: {}, Tipo: {}", name, version, mc_type);
    // Check Auth
    let account = state.account.lock().unwrap().clone();
    if account.is_none() {
        return Err("Você precisa estar logado para criar instâncias.".to_string());
    }

    let client = reqwest::Client::new();

    // 1. Buscar o manifesto para encontrar a URL da versão
    let res = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let manifest = res
        .json::<VersionManifest>()
        .await
        .map_err(|e| e.to_string())?;

    let version_entry = manifest
        .versions
        .iter()
        .find(|v| v.id == version)
        .ok_or_else(|| "Versão não encontrada no manifesto".to_string())?;

    // 2. Buscar detalhes da versão
    let res = client
        .get(&version_entry.url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let details = res
        .json::<VersionDetail>()
        .await
        .map_err(|e| e.to_string())?;

    // 3. Preparar diretório
    let id = urlencoding::encode(&name.to_lowercase().replace(' ', "_")).to_string();
    let instance_path = state.instances_path.join(&id);
    if !instance_path.exists() {
        std::fs::create_dir_all(&instance_path).map_err(|e| e.to_string())?;
    }

    // 4. Baixar arquivos essenciais do Minecraft primeiro
    download_instance_files(&instance_path, &details).await?;

    // 5. Instalar loader se especificado (agora que os arquivos já existem)
    let (loader_type_enum, loader_version_final) = if let Some(loader) = &loader_type {
        match loader.as_str() {
            "forge" => {
                if let Some(lv) = &loader_version {
                    install_forge_loader(&instance_path, &version, lv).await?;
                    (Some(LoaderType::Forge), Some(lv.clone()))
                } else {
                    return Err("Versão do Forge é obrigatória".to_string());
                }
            }
            "fabric" => {
                if let Some(lv) = &loader_version {
                    install_fabric_loader(&instance_path, &version, lv).await?;
                    (Some(LoaderType::Fabric), Some(lv.clone()))
                } else {
                    return Err("Versão do Fabric é obrigatória".to_string());
                }
            }
            "neoforge" => {
                if let Some(lv) = &loader_version {
                    install_neoforge_loader(&instance_path, &version, lv).await?;
                    (Some(LoaderType::NeoForge), Some(lv.clone()))
                } else {
                    return Err("Versão do NeoForge é obrigatória".to_string());
                }
            }
            "vanilla" => (None, None),
            _ => {
                return Err(format!(
                    "Loader '{}' não é suportado nesta versão do launcher.",
                    loader
                ))
            }
        }
    } else {
        (None, None)
    };

    // 5. Salvar registro
    let instance = Instance {
        id: id.clone(),
        name,
        version: version.clone(),
        mc_type,
        loader_type: Some(loader_type_enum.map_or_else(
            || "Vanilla".to_string(),
            |lt| match lt {
                LoaderType::Fabric => "Fabric".to_string(),
                LoaderType::Forge => "Forge".to_string(),
                LoaderType::NeoForge => "NeoForge".to_string(),
                LoaderType::Quilt => "Quilt".to_string(),
                LoaderType::Vanilla => "Vanilla".to_string(),
            },
        )),
        loader_version: loader_version_final,
        icon: Some(format!(
            "https://api.dicebear.com/9.x/shapes/svg?seed={}",
            id
        )),
        created: chrono::Utc::now().to_rfc3339(),
        last_played: None,
        tempo_total_jogado_segundos: 0,
        sessao_iniciada_em: None,
        path: instance_path.clone(),
        java_args: None,
        mc_args: None,
        memory: None,
        width: None,
        height: None,
    };

    // Salvar instance.json
    let config_path = instance_path.join("instance.json");
    let content = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    std::fs::write(config_path, content).map_err(|e| e.to_string())?;

    // Salvar version_manifest.json (para uso no launch)
    let version_manifest_path = instance_path.join("version_manifest.json");
    let version_content = serde_json::to_string_pretty(&details).map_err(|e| e.to_string())?;
    std::fs::write(version_manifest_path, version_content).map_err(|e| e.to_string())?;

    // 6. Instância criada com sucesso - downloads serão feitos no primeiro launch
    println!("=== CRIAÇÃO DE INSTÂNCIA CONCLUÍDA COM SUCESSO ===");
    Ok(())
}

// ===== FUNÇÃO PARA BAIXAR ASSETS DE FORMA CONTROLADA =====

pub(super) async fn download_assets_safely(
    instance_path: &std::path::Path,
    details: &VersionDetail,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let assets_dir = instance_path.join("assets");
    let indexes_dir = assets_dir.join("indexes");
    let objects_dir = assets_dir.join("objects");

    std::fs::create_dir_all(&indexes_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&objects_dir).map_err(|e| e.to_string())?;

    // Download Asset Index
    let index_path = indexes_dir.join(format!("{}.json", details.asset_index.id));
    let index_content = if !index_path.exists() {
        println!("Baixando asset index...");
        let res = client
            .get(&details.asset_index.url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let text = res.text().await.map_err(|e| e.to_string())?;
        std::fs::write(&index_path, &text).map_err(|e| e.to_string())?;
        text
    } else {
        println!("Asset index já existe");
        std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?
    };

    // Parse e coletar assets para download
    if let Ok(index_json) = serde_json::from_str::<serde_json::Value>(&index_content) {
        if let Some(objects) = index_json["objects"].as_object() {
            let total_objects = objects.len();
            println!("Encontrados {} assets para verificar", total_objects);

            // Estrutura para tarefa de download
            struct AssetTask {
                url: String,
                path: std::path::PathBuf,
            }

            let mut download_tasks: Vec<AssetTask> = Vec::new();

            for (_key, obj) in objects.iter() {
                if let Some(hash) = obj["hash"].as_str() {
                    let prefix = &hash[0..2];
                    let object_path = objects_dir.join(prefix).join(hash);

                    if !object_path.exists() {
                        if let Some(parent) = object_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }

                        let url = format!(
                            "https://resources.download.minecraft.net/{}/{}",
                            prefix, hash
                        );

                        download_tasks.push(AssetTask {
                            url,
                            path: object_path,
                        });
                    }
                }
            }

            let tasks_count = download_tasks.len();
            let already_downloaded = total_objects - tasks_count;

            if tasks_count == 0 {
                println!("Todos os {} assets já estão baixados!", total_objects);
            } else {
                println!(
                    "Iniciando download paralelo de {} assets ({} já existem)...",
                    tasks_count, already_downloaded
                );

                // Download paralelo com limite de 50 concorrências para assets (são pequenos)
                let concurrency_limit = 50;
                let client_clone = client.clone();

                let results: Vec<Result<(), String>> = stream::iter(download_tasks)
                    .map(|task| {
                        let client = client_clone.clone();
                        async move {
                            match client.get(&task.url).send().await {
                                Ok(res) => match res.bytes().await {
                                    Ok(bytes) => {
                                        std::fs::write(&task.path, bytes).ok();
                                        Ok(())
                                    }
                                    Err(e) => Err(format!("Erro ao ler bytes: {}", e)),
                                },
                                Err(e) => Err(format!("Erro ao baixar: {}", e)),
                            }
                        }
                    })
                    .buffer_unordered(concurrency_limit)
                    .collect()
                    .await;

                let downloaded = results.iter().filter(|r| r.is_ok()).count();
                println!(
                    "Assets concluídos: {} de {} baixados",
                    downloaded + already_downloaded,
                    total_objects
                );
            }
        }
    }

    Ok(())
}

// ===== FUNÇÃO AUXILIAR PARA BAIXAR ARQUIVOS DA INSTÂNCIA =====

pub(super) async fn download_instance_files(
    instance_path: &std::path::Path,
    details: &VersionDetail,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Download do Client Jar
    let client_download_url = &details.downloads.client.url;

    let bin_path = instance_path.join("bin");
    std::fs::create_dir_all(&bin_path).map_err(|e| e.to_string())?;

    if !bin_path.join("client.jar").exists() {
        let jar_res = client
            .get(client_download_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let mut file =
            std::fs::File::create(bin_path.join("client.jar")).map_err(|e| e.to_string())?;
        let content = jar_res.bytes().await.map_err(|e| e.to_string())?;
        std::io::copy(&mut &content[..], &mut file).map_err(|e| e.to_string())?;
    }

    // 2. Download das Bibliotecas (PARALELO)
    let libraries_path = instance_path.join("libraries");
    let total_libs = details.libraries.len();

    // Coletar todos os downloads necessários
    struct DownloadTask {
        url: String,
        path: std::path::PathBuf,
    }

    let mut download_tasks: Vec<DownloadTask> = Vec::new();

    for lib in &details.libraries {
        // Verificação de Regras (Basic Windows Check)
        let mut allowed = true;
        if let Some(rules) = &lib.rules {
            for rule in rules {
                if rule.action == "allow" {
                    if let Some(os) = &rule.os {
                        if os.name != "windows" {
                            allowed = false;
                        }
                    }
                } else if rule.action == "disallow" {
                    if let Some(os) = &rule.os {
                        if os.name == "windows" {
                            allowed = false;
                        }
                    }
                }
            }
        }

        if allowed {
            if let Some(downloads) = &lib.downloads {
                // Artifact (Library comum)
                if let Some(artifact) = &downloads.artifact {
                    if let Some(path) = &artifact.path {
                        let lib_file_path = libraries_path.join(path);
                        if !lib_file_path.exists() {
                            // Criar diretório pai se não existir
                            if let Some(parent) = lib_file_path.parent() {
                                std::fs::create_dir_all(parent).ok();
                            }
                            download_tasks.push(DownloadTask {
                                url: artifact.url.clone(),
                                path: lib_file_path,
                            });
                        }
                    }
                }

                // Classifiers (Natives)
                if let Some(classifiers) = &downloads.classifiers {
                    let native_key = "natives-windows";
                    if let Some(native_obj) = classifiers.get(native_key) {
                        if let Some(url) = native_obj["url"].as_str() {
                            if let Some(path) = native_obj["path"].as_str() {
                                let native_path = libraries_path.join(path);
                                if !native_path.exists() {
                                    if let Some(parent) = native_path.parent() {
                                        std::fs::create_dir_all(parent).ok();
                                    }
                                    download_tasks.push(DownloadTask {
                                        url: url.to_string(),
                                        path: native_path,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let tasks_count = download_tasks.len();
    println!(
        "Iniciando download paralelo de {} bibliotecas (de {} total)...",
        tasks_count, total_libs
    );

    // Download paralelo com limite de 20 concorrências
    let concurrency_limit = 20;
    let client_clone = client.clone();

    let results: Vec<Result<(), String>> = stream::iter(download_tasks)
        .map(|task| {
            let client = client_clone.clone();
            async move {
                match client.get(&task.url).send().await {
                    Ok(res) => match res.bytes().await {
                        Ok(bytes) => {
                            std::fs::write(&task.path, bytes).ok();
                            Ok(())
                        }
                        Err(e) => Err(format!("Erro ao ler bytes: {}", e)),
                    },
                    Err(e) => Err(format!("Erro ao baixar: {}", e)),
                }
            }
        })
        .buffer_unordered(concurrency_limit)
        .collect()
        .await;

    let downloaded_libs = results.iter().filter(|r| r.is_ok()).count();
    println!(
        "Libraries concluídas: {} de {} baixadas",
        downloaded_libs, tasks_count
    );

    // 3. Assets - Download controlado para evitar travamentos
    println!("Iniciando download de assets...");
    download_assets_safely(&instance_path, &details).await?;

    Ok(())
}

// ===== FUNÇÕES DE AJUSTE DE MANIFESTO PARA LOADERS =====

pub(super) async fn adjust_forge_manifest(
    details: &mut VersionDetail,
    forge_version: &str,
) -> Result<(), String> {
    // Para Forge, precisamos baixar o manifesto específico do Forge
    let versao_forge = versao_forge_completa(&details.id, forge_version);
    let build_forge = extrair_build_forge(&details.id, forge_version);
    let client = reqwest::Client::new();
    let forge_manifest_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}.json",
        versao_forge, versao_forge
    );

    let response = client
        .get(&forge_manifest_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        let forge_details: VersionDetail = response.json().await.map_err(|e| e.to_string())?;
        *details = forge_details;
    } else {
        // Fallback para Forge legado (ex.: 1.12.2), onde o .json do Maven pode não existir.
        details.main_class = "net.minecraft.launchwrapper.Launch".to_string();

        // Adicionar argumentos específicos do Forge.
        if let Some(args) = &mut details.arguments {
            if let Some(game_args) = args.get_mut("game") {
                if let Some(arr) = game_args.as_array_mut() {
                    arr.push(serde_json::json!("--tweakClass"));
                    arr.push(serde_json::json!(
                        "net.minecraftforge.fml.common.launcher.FMLTweaker"
                    ));
                    arr.push(serde_json::json!("--fml.forgeVersion"));
                    arr.push(serde_json::json!(build_forge));
                }
            }
        } else if let Some(legacy) = &mut details.minecraft_arguments {
            if !legacy.contains("--tweakClass") {
                legacy.push_str(" --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker");
            }
            if !legacy.contains("--fml.forgeVersion") {
                legacy.push_str(&format!(" --fml.forgeVersion {}", build_forge));
            }
        } else {
            details.minecraft_arguments = Some(format!(
                "--tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --fml.forgeVersion {}",
                build_forge
            ));
        }
    }

    Ok(())
}

pub(super) async fn adjust_fabric_manifest(
    details: &mut VersionDetail,
    _fabric_version: &str,
    instance_path: &std::path::Path,
) -> Result<(), String> {
    // Carregar manifesto do Fabric
    let fabric_manifest_path = instance_path.join("fabric_manifest.json");

    if !fabric_manifest_path.exists() {
        return Err("Manifesto do Fabric não encontrado. Recrie a instância.".to_string());
    }

    let fabric_content = std::fs::read_to_string(&fabric_manifest_path)
        .map_err(|e| format!("Erro ao ler manifesto Fabric: {}", e))?;
    let fabric_profile: serde_json::Value = serde_json::from_str(&fabric_content)
        .map_err(|e| format!("Erro ao parsear manifesto Fabric: {}", e))?;

    // Atualizar main class do Fabric
    if let Some(main_class) = fabric_profile["mainClass"].as_str() {
        details.main_class = main_class.to_string();
    } else {
        details.main_class = "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string();
    }

    // Adicionar bibliotecas do Fabric ao details
    if let Some(fabric_libs) = fabric_profile["libraries"].as_array() {
        let libraries_path = instance_path.join("libraries");

        // Coletar nomes de artifacts do Fabric para remover duplicatas do Minecraft
        let mut fabric_artifacts: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        for lib in fabric_libs {
            if let Some(name) = lib["name"].as_str() {
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    // Chave: group:artifact (sem versão)
                    let artifact_key = format!("{}:{}", parts[0], parts[1]);
                    fabric_artifacts.insert(artifact_key);
                }
            }
        }

        // Remover bibliotecas do Minecraft que serão substituídas pelo Fabric
        details.libraries.retain(|lib| {
            let parts: Vec<&str> = lib.name.split(':').collect();
            if parts.len() >= 2 {
                let artifact_key = format!("{}:{}", parts[0], parts[1]);
                if fabric_artifacts.contains(&artifact_key) {
                    println!("[Fabric] Substituindo biblioteca: {}", lib.name);
                    return false; // Remover do Minecraft
                }
            }
            true // Manter
        });

        // Agora adicionar bibliotecas do Fabric
        for lib in fabric_libs {
            if let Some(name) = lib["name"].as_str() {
                // Formato Maven: group:artifact:version
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    let group = parts[0].replace('.', "/");
                    let artifact = parts[1];
                    let version = parts[2];

                    let jar_path = format!(
                        "{}/{}/{}/{}-{}.jar",
                        group, artifact, version, artifact, version
                    );

                    let full_path = libraries_path.join(&jar_path);

                    // Criar uma nova entrada de biblioteca
                    let new_lib = crate::launcher::Library {
                        name: name.to_string(),
                        rules: None,
                        downloads: Some(crate::launcher::LibraryDownloads {
                            artifact: Some(crate::launcher::Artifact {
                                path: Some(jar_path),
                                url: lib["url"]
                                    .as_str()
                                    .map(|u| {
                                        format!(
                                            "{}{}/{}/{}/{}-{}.jar",
                                            u, group, artifact, version, artifact, version
                                        )
                                    })
                                    .unwrap_or_default(),
                                sha1: None,
                                size: None,
                            }),
                            classifiers: None,
                        }),
                        natives: None,
                    };

                    // Adicionar apenas se o arquivo existe
                    if full_path.exists() {
                        details.libraries.push(new_lib);
                    }
                }
            }
        }
    }

    // Adicionar argumentos do Fabric (se existirem no manifesto)
    if let Some(args) = fabric_profile["arguments"].as_object() {
        if let Some(jvm_args) = args.get("jvm") {
            if let Some(jvm_arr) = jvm_args.as_array() {
                if let Some(details_args) = &mut details.arguments {
                    if let Some(details_jvm) = details_args.get_mut("jvm") {
                        if let Some(arr) = details_jvm.as_array_mut() {
                            for arg in jvm_arr {
                                arr.push(arg.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    println!(
        "[Fabric] Manifesto ajustado - {} bibliotecas adicionadas",
        details.libraries.len()
    );
    Ok(())
}

pub(super) async fn adjust_neoforge_manifest(
    details: &mut VersionDetail,
    neoforge_version: &str,
) -> Result<(), String> {
    // Para NeoForge, similar ao Forge
    let client = reqwest::Client::new();
    let neoforge_manifest_url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}.json",
        neoforge_version, neoforge_version
    );

    let response = client
        .get(&neoforge_manifest_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        let neoforge_details: VersionDetail = response.json().await.map_err(|e| e.to_string())?;
        *details = neoforge_details;
    }

    Ok(())
}

fn substituir_placeholders_jvm(
    arg: &str,
    natives_path: &std::path::Path,
    libraries_path: &std::path::Path,
    classpath: &str,
) -> String {
    arg.replace(
        "${natives_directory}",
        &natives_path.to_string_lossy(),
    )
    .replace(
        "${library_directory}",
        &libraries_path.to_string_lossy(),
    )
    .replace("${classpath_separator}", ";")
    .replace("${classpath}", classpath)
    .replace("${launcher_name}", "DomeLauncher")
    .replace("${launcher_version}", env!("CARGO_PKG_VERSION"))
}

pub(super) fn coletar_argumentos_jvm_manifesto(
    details: &VersionDetail,
    natives_path: &std::path::Path,
    libraries_path: &std::path::Path,
    classpath: &str,
) -> Vec<String> {
    let mut args_jvm = Vec::new();
    let mut ignorar_proximo_classpath = false;

    let Some(arguments) = &details.arguments else {
        return args_jvm;
    };
    let Some(jvm_args) = arguments.get("jvm").and_then(|v| v.as_array()) else {
        return args_jvm;
    };

    for valor in jvm_args {
        let Some(arg_raw) = valor.as_str() else {
            continue;
        };

        let arg_raw_trim = arg_raw.trim();
        if ignorar_proximo_classpath {
            ignorar_proximo_classpath = false;
            continue;
        }

        // O classpath é montado manualmente pelo launcher.
        if arg_raw_trim == "-cp" || arg_raw_trim == "-classpath" {
            ignorar_proximo_classpath = true;
            continue;
        }
        if arg_raw_trim == "${classpath}" {
            continue;
        }

        let mut arg = substituir_placeholders_jvm(arg_raw, natives_path, libraries_path, classpath)
            .trim()
            .to_string();

        if arg.starts_with("-DFabricMcEmu=") {
            let valor = arg["-DFabricMcEmu=".len()..].trim();
            arg = format!("-DFabricMcEmu={}", valor);
        }

        // Ignorar parâmetros já controlados pelo launcher.
        if arg.is_empty()
            || arg == "-cp"
            || arg == "-classpath"
            || arg == classpath
            || arg.starts_with("-Djava.library.path=")
            || arg.starts_with("-Xmx")
            || arg.starts_with("-Xms")
        {
            continue;
        }

        // Se ainda restou placeholder não resolvido, evita quebrar o launch.
        if arg.contains("${") {
            continue;
        }

        args_jvm.push(arg);
    }

    args_jvm
}


