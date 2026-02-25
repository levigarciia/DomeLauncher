use super::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstanciaImportavelExterna {
    pub id_externo: String,
    pub launcher: String,
    pub nome: String,
    pub versao_minecraft: String,
    pub loader_type: Option<String>,
    pub loader_version: Option<String>,
    pub caminho_origem: String,
    pub caminho_jogo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoImportacaoInstancia {
    pub id_externo: String,
    pub launcher: String,
    pub nome_origem: String,
    pub sucesso: bool,
    pub instancia_id: Option<String>,
    pub mensagem: String,
}

fn listar_instancias_prism() -> Vec<InstanciaImportavelExterna> {
    let Some(app_data) = std::env::var("APPDATA").ok() else {
        return Vec::new();
    };

    let pasta_instancias = std::path::PathBuf::from(app_data)
        .join("PrismLauncher")
        .join("instances");
    if !pasta_instancias.exists() {
        return Vec::new();
    }

    let mut resultados = Vec::new();
    let entradas = match std::fs::read_dir(&pasta_instancias) {
        Ok(valor) => valor,
        Err(_) => return resultados,
    };

    for entrada in entradas.flatten() {
        if !entrada.path().is_dir() {
            continue;
        }

        let caminho_origem = entrada.path();
        let caminho_cfg = caminho_origem.join("instance.cfg");
        if !caminho_cfg.exists() {
            continue;
        }

        let cfg = parsear_cfg_simples(&caminho_cfg);
        let nome = cfg
            .get("name")
            .cloned()
            .unwrap_or_else(|| entrada.file_name().to_string_lossy().to_string());

        let mut versao_minecraft = String::new();
        let mut loader_tipo: Option<String> = None;
        let mut loader_versao: Option<String> = None;

        let caminho_mmc_pack = caminho_origem.join("mmc-pack.json");
        if caminho_mmc_pack.exists() {
            if let Ok(conteudo) = std::fs::read_to_string(&caminho_mmc_pack) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&conteudo) {
                    if let Some(componentes) = json.get("components").and_then(|v| v.as_array()) {
                        for componente in componentes {
                            let uid = texto_json_caminho(componente, &["uid"]).unwrap_or_default();
                            let versao = texto_json_caminho(componente, &["version"]);

                            match uid.as_str() {
                                "net.minecraft" => {
                                    if versao_minecraft.is_empty() {
                                        versao_minecraft = versao.unwrap_or_default();
                                    }
                                }
                                "net.minecraftforge" => {
                                    loader_tipo = Some("Forge".to_string());
                                    loader_versao = versao;
                                }
                                "net.fabricmc.fabric-loader" => {
                                    loader_tipo = Some("Fabric".to_string());
                                    loader_versao = versao;
                                }
                                "net.neoforged" => {
                                    loader_tipo = Some("NeoForge".to_string());
                                    loader_versao = versao;
                                }
                                "org.quiltmc.quilt-loader" => {
                                    loader_tipo = Some("Quilt".to_string());
                                    loader_versao = versao;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        if versao_minecraft.trim().is_empty() {
            continue;
        }

        let caminho_jogo = detectar_caminho_jogo(&caminho_origem);
        resultados.push(InstanciaImportavelExterna {
            id_externo: format!("prism:{}", caminho_origem.to_string_lossy()),
            launcher: "prism".to_string(),
            nome,
            versao_minecraft,
            loader_type: loader_tipo,
            loader_version: loader_versao,
            caminho_origem: caminho_origem.to_string_lossy().to_string(),
            caminho_jogo: caminho_jogo.to_string_lossy().to_string(),
        });
    }

    resultados
}

fn listar_instancias_modrinth_por_profile_json(
    pasta_base: &std::path::Path,
) -> Vec<InstanciaImportavelExterna> {
    let mut resultados = Vec::new();
    let entradas = match std::fs::read_dir(pasta_base) {
        Ok(valor) => valor,
        Err(_) => return resultados,
    };

    for entrada in entradas.flatten() {
        if !entrada.path().is_dir() {
            continue;
        }

        let caminho_origem = entrada.path();
        let caminho_profile = caminho_origem.join("profile.json");
        if !caminho_profile.exists() {
            continue;
        }

        let conteudo = match std::fs::read_to_string(&caminho_profile) {
            Ok(valor) => valor,
            Err(_) => continue,
        };
        let json = match serde_json::from_str::<serde_json::Value>(&conteudo) {
            Ok(valor) => valor,
            Err(_) => continue,
        };

        let nome = texto_json_caminho(&json, &["metadata", "name"])
            .or_else(|| texto_json_caminho(&json, &["name"]))
            .unwrap_or_else(|| entrada.file_name().to_string_lossy().to_string());

        let versao_minecraft = texto_json_caminho(&json, &["metadata", "game_version"])
            .or_else(|| texto_json_caminho(&json, &["game_version"]))
            .unwrap_or_default();
        if versao_minecraft.is_empty() {
            continue;
        }

        let loader_normalizado = detectar_loader_normalizado(
            texto_json_caminho(&json, &["metadata", "loader"])
                .or_else(|| texto_json_caminho(&json, &["loader"]))
                .as_deref(),
        );
        let loader_type = rotulo_loader(loader_normalizado.as_deref());
        let loader_version = texto_json_caminho(&json, &["metadata", "loader_version"])
            .or_else(|| texto_json_caminho(&json, &["loader_version"]));

        let caminho_jogo = texto_json_caminho(&json, &["path"])
            .map(std::path::PathBuf::from)
            .filter(|c| c.exists() && c.is_dir())
            .unwrap_or_else(|| caminho_origem.clone());

        resultados.push(InstanciaImportavelExterna {
            id_externo: format!("modrinth:{}", caminho_origem.to_string_lossy()),
            launcher: "modrinth".to_string(),
            nome,
            versao_minecraft,
            loader_type,
            loader_version,
            caminho_origem: caminho_origem.to_string_lossy().to_string(),
            caminho_jogo: caminho_jogo.to_string_lossy().to_string(),
        });
    }

    resultados
}

fn listar_instancias_modrinth_por_banco(
    pasta_base: &std::path::Path,
) -> Vec<InstanciaImportavelExterna> {
    let mut resultados = Vec::new();
    let Some(pasta_app) = pasta_base.parent() else {
        return resultados;
    };
    let caminho_banco = pasta_app.join("app.db");
    if !caminho_banco.exists() {
        return resultados;
    }

    let conexao = match rusqlite::Connection::open_with_flags(
        &caminho_banco,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(c) => c,
        Err(_) => return resultados,
    };

    let mut consulta = match conexao.prepare(
        "SELECT path, name, game_version, mod_loader, mod_loader_version FROM profiles",
    ) {
        Ok(c) => c,
        Err(_) => return resultados,
    };

    let linhas = match consulta.query_map([], |linha| {
        let caminho_perfil: String = linha.get(0)?;
        let nome: String = linha.get(1)?;
        let versao_minecraft: String = linha.get(2)?;
        let mod_loader: String = linha.get(3)?;
        let mod_loader_version: Option<String> = linha.get(4)?;
        Ok((
            caminho_perfil,
            nome,
            versao_minecraft,
            mod_loader,
            mod_loader_version,
        ))
    }) {
        Ok(l) => l,
        Err(_) => return resultados,
    };

    for linha in linhas.flatten() {
        let (caminho_perfil, nome_banco, versao_minecraft, mod_loader, mod_loader_version) = linha;
        if versao_minecraft.trim().is_empty() {
            continue;
        }

        let caminho_origem = {
            let caminho = std::path::PathBuf::from(caminho_perfil.trim());
            if caminho.is_absolute() {
                caminho
            } else {
                pasta_base.join(caminho)
            }
        };

        if !caminho_origem.exists() || !caminho_origem.is_dir() {
            continue;
        }

        let nome = if nome_banco.trim().is_empty() {
            caminho_origem
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.to_string())
                .unwrap_or_else(|| "Instância Modrinth".to_string())
        } else {
            nome_banco
        };

        let loader_normalizado = detectar_loader_normalizado(Some(&mod_loader));
        let loader_type = rotulo_loader(loader_normalizado.as_deref());
        let loader_version = mod_loader_version
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        resultados.push(InstanciaImportavelExterna {
            id_externo: format!("modrinth:{}", caminho_origem.to_string_lossy()),
            launcher: "modrinth".to_string(),
            nome,
            versao_minecraft: versao_minecraft.trim().to_string(),
            loader_type,
            loader_version,
            caminho_origem: caminho_origem.to_string_lossy().to_string(),
            caminho_jogo: caminho_origem.to_string_lossy().to_string(),
        });
    }

    resultados
}

fn listar_instancias_modrinth() -> Vec<InstanciaImportavelExterna> {
    let Some(app_data) = std::env::var("APPDATA").ok() else {
        return Vec::new();
    };

    let pastas_base = vec![
        std::path::PathBuf::from(&app_data)
            .join("com.modrinth.theseus")
            .join("profiles"),
        std::path::PathBuf::from(&app_data)
            .join("ModrinthApp")
            .join("profiles"),
        std::path::PathBuf::from(&app_data).join("theseus").join("profiles"),
    ];

    let mut resultados = Vec::new();
    for pasta_base in pastas_base {
        if !pasta_base.exists() {
            continue;
        }

        resultados.extend(listar_instancias_modrinth_por_profile_json(&pasta_base));
        resultados.extend(listar_instancias_modrinth_por_banco(&pasta_base));
    }

    resultados
}

fn extrair_loader_curseforge(
    base_mod_loader: &serde_json::Value,
    versao_minecraft: &str,
) -> (Option<String>, Option<String>) {
    let nome = texto_json_caminho(base_mod_loader, &["name"]).unwrap_or_default();
    let maven = texto_json_caminho(base_mod_loader, &["mavenVersionString"]).unwrap_or_default();
    let combinado = format!("{} {}", nome, maven);
    let loader_normalizado = detectar_loader_normalizado(Some(&combinado));
    let loader_type = rotulo_loader(loader_normalizado.as_deref());

    let mut loader_version = None;

    if let Some(parte_maven) = maven.split(':').next_back() {
        let texto = parte_maven.trim();
        if !texto.is_empty() {
            loader_version = Some(texto.to_string());
        }
    }

    if loader_version.is_none() && !nome.trim().is_empty() {
        let nome_lower = nome.to_lowercase();
        let prefixos = ["forge-", "fabric-", "fabric_loader-", "neoforge-", "quilt-"];
        for prefixo in prefixos {
            if nome_lower.starts_with(prefixo) {
                loader_version = Some(nome[prefixo.len()..].to_string());
                break;
            }
        }
    }

    if let Some(loader) = loader_normalizado {
        if loader == "forge" {
            if let Some(ref mut versao_loader) = loader_version {
                if !versao_loader.starts_with(&format!("{}-", versao_minecraft))
                    && !versao_loader.starts_with("1.")
                {
                    *versao_loader = format!("{}-{}", versao_minecraft, versao_loader);
                }
            }
        }
    }

    (loader_type, loader_version)
}

fn listar_instancias_curseforge() -> Vec<InstanciaImportavelExterna> {
    let Some(user_profile) = std::env::var("USERPROFILE").ok() else {
        return Vec::new();
    };

    let pastas_base = vec![
        std::path::PathBuf::from(&user_profile)
            .join("curseforge")
            .join("minecraft")
            .join("Instances"),
        std::path::PathBuf::from(&user_profile)
            .join("Documents")
            .join("Curse")
            .join("Minecraft")
            .join("Instances"),
    ];

    let mut resultados = Vec::new();

    for pasta_base in pastas_base {
        if !pasta_base.exists() {
            continue;
        }

        let entradas = match std::fs::read_dir(&pasta_base) {
            Ok(valor) => valor,
            Err(_) => continue,
        };

        for entrada in entradas.flatten() {
            if !entrada.path().is_dir() {
                continue;
            }

            let caminho_origem = entrada.path();
            let caminho_instancia = caminho_origem.join("minecraftinstance.json");
            if !caminho_instancia.exists() {
                continue;
            }

            let conteudo = match std::fs::read_to_string(&caminho_instancia) {
                Ok(valor) => valor,
                Err(_) => continue,
            };
            let json = match serde_json::from_str::<serde_json::Value>(&conteudo) {
                Ok(valor) => valor,
                Err(_) => continue,
            };

            let nome = texto_json_caminho(&json, &["name"])
                .unwrap_or_else(|| entrada.file_name().to_string_lossy().to_string());
            let versao_minecraft = texto_json_caminho(&json, &["gameVersion"])
                .or_else(|| texto_json_caminho(&json, &["minecraftVersion"]))
                .unwrap_or_default();
            if versao_minecraft.is_empty() {
                continue;
            }

            let (loader_type, loader_version) =
                extrair_loader_curseforge(&json["baseModLoader"], &versao_minecraft);
            let caminho_jogo = detectar_caminho_jogo(&caminho_origem);

            resultados.push(InstanciaImportavelExterna {
                id_externo: format!("curseforge:{}", caminho_origem.to_string_lossy()),
                launcher: "curseforge".to_string(),
                nome,
                versao_minecraft,
                loader_type,
                loader_version,
                caminho_origem: caminho_origem.to_string_lossy().to_string(),
                caminho_jogo: caminho_jogo.to_string_lossy().to_string(),
            });
        }
    }

    resultados
}

#[tauri::command]
pub(crate) fn listar_instancias_importaveis() -> Result<Vec<InstanciaImportavelExterna>, String> {
    let mut resultados = Vec::new();
    resultados.extend(listar_instancias_prism());
    resultados.extend(listar_instancias_modrinth());
    resultados.extend(listar_instancias_curseforge());

    let mut caminhos_vistos = std::collections::HashSet::new();
    resultados.retain(|instancia| {
        caminhos_vistos.insert(instancia.caminho_origem.trim().to_lowercase())
    });

    resultados.sort_by(|a, b| {
        a.launcher
            .cmp(&b.launcher)
            .then_with(|| a.nome.to_lowercase().cmp(&b.nome.to_lowercase()))
    });

    Ok(resultados)
}

fn copiar_arquivo_se_existir(
    origem: &std::path::Path,
    destino: &std::path::Path,
) -> Result<(), String> {
    if !origem.exists() || !origem.is_file() {
        return Ok(());
    }

    if let Some(pai) = destino.parent() {
        std::fs::create_dir_all(pai).map_err(|e| format!("Erro ao criar pasta destino: {}", e))?;
    }
    std::fs::copy(origem, destino).map_err(|e| format!("Erro ao copiar arquivo: {}", e))?;
    Ok(())
}

fn copiar_diretorio_recursivo(
    origem: &std::path::Path,
    destino: &std::path::Path,
) -> Result<(), String> {
    if !origem.exists() || !origem.is_dir() {
        return Ok(());
    }

    std::fs::create_dir_all(destino).map_err(|e| format!("Erro ao criar pasta destino: {}", e))?;
    let entradas = std::fs::read_dir(origem).map_err(|e| format!("Erro ao ler pasta origem: {}", e))?;

    for entrada in entradas.flatten() {
        let tipo = match entrada.file_type() {
            Ok(valor) => valor,
            Err(_) => continue,
        };
        if tipo.is_symlink() {
            continue;
        }

        let origem_item = entrada.path();
        let destino_item = destino.join(entrada.file_name());

        if tipo.is_dir() {
            copiar_diretorio_recursivo(&origem_item, &destino_item)?;
        } else if tipo.is_file() {
            copiar_arquivo_se_existir(&origem_item, &destino_item)?;
        }
    }

    Ok(())
}

fn copiar_conteudo_instancia_importada(
    caminho_jogo_origem: &std::path::Path,
    pasta_instancia_destino: &std::path::Path,
) -> Result<(), String> {
    if !caminho_jogo_origem.exists() || !caminho_jogo_origem.is_dir() {
        return Err("Pasta do jogo da instância importada não encontrada.".to_string());
    }

    let pastas_para_copiar = [
        "mods",
        "resourcepacks",
        "shaderpacks",
        "saves",
        "config",
        "defaultconfigs",
        "kubejs",
        "scripts",
        "journeymap",
        "xaeromap",
        "XaeroWaypoints",
        "servers",
    ];
    for pasta in pastas_para_copiar {
        let origem = caminho_jogo_origem.join(pasta);
        let destino = pasta_instancia_destino.join(pasta);
        copiar_diretorio_recursivo(&origem, &destino)?;
    }

    let arquivos_para_copiar = [
        "options.txt",
        "optionsof.txt",
        "optionsshaders.txt",
        "servers.dat",
        "usercache.json",
    ];
    for arquivo in arquivos_para_copiar {
        let origem = caminho_jogo_origem.join(arquivo);
        let destino = pasta_instancia_destino.join(arquivo);
        copiar_arquivo_se_existir(&origem, &destino)?;
    }

    Ok(())
}

fn gerar_nome_instancia_unico(state: &LauncherState, nome_base: &str) -> String {
    let nome_base = if nome_base.trim().is_empty() {
        "Instância importada".to_string()
    } else {
        nome_base.trim().to_string()
    };

    let mut ids_existentes: std::collections::HashSet<String> = state
        .get_instances()
        .unwrap_or_default()
        .into_iter()
        .map(|instancia| instancia.id)
        .collect();

    if let Ok(entradas) = std::fs::read_dir(&state.instances_path) {
        for entrada in entradas.flatten() {
            if entrada.path().is_dir() {
                ids_existentes.insert(entrada.file_name().to_string_lossy().to_string());
            }
        }
    }

    let mut nome_tentativa = nome_base.clone();
    let mut contador = 2;
    loop {
        let id_tentativa = super::instancias_basicas::normalizar_nome_pasta_instancia(&nome_tentativa);
        if !ids_existentes.contains(&id_tentativa) {
            return nome_tentativa;
        }
        nome_tentativa = format!("{} ({})", nome_base, contador);
        contador += 1;
    }
}

async fn resolver_versao_loader_importacao(
    loader_normalizado: &str,
    versao_minecraft: &str,
    versao_sugerida: Option<&str>,
) -> Result<String, String> {
    if let Some(versao) = versao_sugerida.map(|v| v.trim()).filter(|v| !v.is_empty()) {
        if loader_normalizado == "forge" {
            if versao.starts_with(&format!("{}-", versao_minecraft)) {
                return Ok(versao.to_string());
            }
            if versao.chars().next().is_some_and(|c| c.is_ascii_digit()) && !versao.starts_with("1.")
            {
                return Ok(format!("{}-{}", versao_minecraft, versao));
            }
        }
        return Ok(versao.to_string());
    }

    let resposta = super::instancias_criacao::get_loader_versions(loader_normalizado.to_string()).await?;
    let versoes: Vec<String> = resposta.versions.into_iter().map(|v| v.version).collect();
    if loader_normalizado == "forge" {
        if let Some(versao) = versoes
            .iter()
            .find(|versao| versao.starts_with(&format!("{}-", versao_minecraft)))
            .cloned()
        {
            return Ok(versao);
        }
    }

    versoes
        .into_iter()
        .next()
        .ok_or_else(|| format!("Nenhuma versão disponível para loader {}.", loader_normalizado))
}

async fn criar_instancia_base_importada(
    state: &LauncherState,
    nome_instancia: &str,
    versao_minecraft: &str,
    loader_type: Option<&str>,
    loader_version: Option<&str>,
) -> Result<Instance, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar manifesto Minecraft: {}", e))?;
    let manifest = res
        .json::<VersionManifest>()
        .await
        .map_err(|e| format!("Erro ao ler manifesto Minecraft: {}", e))?;

    let version_entry = manifest
        .versions
        .iter()
        .find(|v| v.id == versao_minecraft)
        .ok_or_else(|| format!("Versão Minecraft '{}' não encontrada.", versao_minecraft))?;

    let res = client
        .get(&version_entry.url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar detalhes da versão: {}", e))?;
    let details = res
        .json::<VersionDetail>()
        .await
        .map_err(|e| format!("Erro ao ler detalhes da versão: {}", e))?;

    let id = super::instancias_basicas::normalizar_nome_pasta_instancia(nome_instancia);
    let instance_path = state.instances_path.join(&id);
    if !instance_path.exists() {
        std::fs::create_dir_all(&instance_path).map_err(|e| e.to_string())?;
    }

    super::instancias_criacao::download_instance_files(&instance_path, &details).await?;

    let loader_normalizado = detectar_loader_normalizado(loader_type);
    let (loader_type_salvo, loader_version_final, mc_type) = match loader_normalizado.as_deref() {
        Some("forge") => {
            let versao_loader = resolver_versao_loader_importacao(
                "forge",
                versao_minecraft,
                loader_version,
            )
            .await?;
            super::instancias_criacao::install_forge_loader(&instance_path, versao_minecraft, &versao_loader).await?;
            (
                Some("Forge".to_string()),
                Some(versao_loader),
                "forge".to_string(),
            )
        }
        Some("fabric") => {
            let versao_loader = resolver_versao_loader_importacao(
                "fabric",
                versao_minecraft,
                loader_version,
            )
            .await?;
            super::instancias_criacao::install_fabric_loader(&instance_path, versao_minecraft, &versao_loader).await?;
            (
                Some("Fabric".to_string()),
                Some(versao_loader),
                "fabric".to_string(),
            )
        }
        Some("neoforge") => {
            let versao_loader = resolver_versao_loader_importacao(
                "neoforge",
                versao_minecraft,
                loader_version,
            )
            .await?;
            super::instancias_criacao::install_neoforge_loader(&instance_path, versao_minecraft, &versao_loader).await?;
            (
                Some("NeoForge".to_string()),
                Some(versao_loader),
                "neoforge".to_string(),
            )
        }
        Some("quilt") => {
            return Err("Instâncias com Quilt ainda não são suportadas no importador.".to_string());
        }
        Some("vanilla") | None => (Some("Vanilla".to_string()), None, "vanilla".to_string()),
        Some(outro) => {
            return Err(format!(
                "Loader '{}' ainda não é suportado no importador.",
                outro
            ))
        }
    };

    let instance = Instance {
        id: id.clone(),
        name: nome_instancia.to_string(),
        version: versao_minecraft.to_string(),
        mc_type,
        loader_type: loader_type_salvo,
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

    let config_path = instance_path.join("instance.json");
    let content = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    std::fs::write(config_path, content).map_err(|e| e.to_string())?;

    let version_manifest_path = instance_path.join("version_manifest.json");
    let version_content = serde_json::to_string_pretty(&details).map_err(|e| e.to_string())?;
    std::fs::write(version_manifest_path, version_content).map_err(|e| e.to_string())?;

    Ok(instance)
}

#[tauri::command]
pub(crate) async fn importar_instancias_externas(
    instancias: Vec<InstanciaImportavelExterna>,
    state: State<'_, LauncherState>,
) -> Result<Vec<ResultadoImportacaoInstancia>, String> {
    if instancias.is_empty() {
        return Ok(Vec::new());
    }

    let mut resultados = Vec::new();

    for instancia in instancias {
        let nome_unico = gerar_nome_instancia_unico(&state, &instancia.nome);
        let resultado = match criar_instancia_base_importada(
            &state,
            &nome_unico,
            instancia.versao_minecraft.trim(),
            instancia.loader_type.as_deref(),
            instancia.loader_version.as_deref(),
        )
        .await
        {
            Ok(instancia_criada) => {
                let caminho_jogo = std::path::PathBuf::from(instancia.caminho_jogo.trim());
                let mensagem_copia =
                    copiar_conteudo_instancia_importada(&caminho_jogo, &instancia_criada.path);
                if let Err(erro_copia) = mensagem_copia {
                    ResultadoImportacaoInstancia {
                        id_externo: instancia.id_externo.clone(),
                        launcher: instancia.launcher.clone(),
                        nome_origem: instancia.nome.clone(),
                        sucesso: true,
                        instancia_id: Some(instancia_criada.id.clone()),
                        mensagem: format!(
                            "Instância importada, mas houve falha ao copiar parte dos arquivos: {}",
                            erro_copia
                        ),
                    }
                } else {
                    ResultadoImportacaoInstancia {
                        id_externo: instancia.id_externo.clone(),
                        launcher: instancia.launcher.clone(),
                        nome_origem: instancia.nome.clone(),
                        sucesso: true,
                        instancia_id: Some(instancia_criada.id.clone()),
                        mensagem: "Instância importada com sucesso.".to_string(),
                    }
                }
            }
            Err(erro) => ResultadoImportacaoInstancia {
                id_externo: instancia.id_externo.clone(),
                launcher: instancia.launcher.clone(),
                nome_origem: instancia.nome.clone(),
                sucesso: false,
                instancia_id: None,
                mensagem: erro,
            },
        };
        resultados.push(resultado);
    }

    Ok(resultados)
}

// ===== EXPORTAÇÃO / IMPORTAÇÃO DE INSTÂNCIAS (ZIP) =====

/// Estrutura do manifesto de exportação do Dome Launcher
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManifestoExportacao {
    pub dome_launcher_version: String,
    pub nome: String,
    pub versao_minecraft: String,
    pub mc_type: String,
    pub loader_type: Option<String>,
    pub loader_version: Option<String>,
    pub exportado_em: String,
    pub icon: Option<String>,
}

/// Resultado da exportação
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoExportacao {
    pub sucesso: bool,
    pub caminho_arquivo: Option<String>,
    pub mensagem: String,
}

/// Resultado da importação por arquivo
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoImportacaoArquivo {
    pub sucesso: bool,
    pub instancia_id: Option<String>,
    pub mensagem: String,
}

/// Adiciona diretório inteiro ao zip recursivamente
fn adicionar_diretorio_ao_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    caminho: &std::path::Path,
    prefixo_no_zip: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    if !caminho.exists() || !caminho.is_dir() {
        return Ok(());
    }

    let entradas = std::fs::read_dir(caminho)
        .map_err(|e| format!("Erro ao ler diretório {}: {}", caminho.display(), e))?;

    for entrada in entradas.flatten() {
        let tipo = match entrada.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if tipo.is_symlink() {
            continue;
        }

        let nome = entrada.file_name().to_string_lossy().to_string();
        let caminho_no_zip = if prefixo_no_zip.is_empty() {
            nome.clone()
        } else {
            format!("{}/{}", prefixo_no_zip, nome)
        };

        if tipo.is_dir() {
            adicionar_diretorio_ao_zip(zip, &entrada.path(), &caminho_no_zip, options)?;
        } else if tipo.is_file() {
            let dados = std::fs::read(&entrada.path())
                .map_err(|e| format!("Erro ao ler arquivo {}: {}", entrada.path().display(), e))?;
            zip.start_file(&caminho_no_zip, options)
                .map_err(|e| format!("Erro ao adicionar {} ao zip: {}", caminho_no_zip, e))?;
            use std::io::Write;
            zip.write_all(&dados)
                .map_err(|e| format!("Erro ao escrever {} no zip: {}", caminho_no_zip, e))?;
        }
    }

    Ok(())
}

fn resolver_pasta_destino_exportacao(destino: Option<&str>) -> std::path::PathBuf {
    if let Some(dest) = destino {
        return std::path::PathBuf::from(dest);
    }

    std::env::var("USERPROFILE")
        .map(|perfil| std::path::PathBuf::from(perfil).join("Downloads"))
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn exportar_instancia_interno(
    state: &LauncherState,
    instance_id: &str,
    destino: Option<&str>,
    incluir_saves: bool,
) -> Result<ResultadoExportacao, String> {
    let instancia = obter_instancia_por_id(state, instance_id)?;
    let pasta_destino = resolver_pasta_destino_exportacao(destino);

    if !pasta_destino.exists() {
        std::fs::create_dir_all(&pasta_destino)
            .map_err(|e| format!("Erro ao criar pasta de destino: {}", e))?;
    }

    // Nome sanitizado para arquivo
    let nome_arquivo = format!(
        "{}.dome",
        instancia.name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
            .collect::<String>()
            .trim()
            .replace(' ', "_")
    );

    let caminho_zip = pasta_destino.join(&nome_arquivo);

    // Criar manifesto
    let manifesto = ManifestoExportacao {
        dome_launcher_version: "1.0".to_string(),
        nome: instancia.name.clone(),
        versao_minecraft: instancia.version.clone(),
        mc_type: instancia.mc_type.clone(),
        loader_type: instancia.loader_type.clone(),
        loader_version: instancia.loader_version.clone(),
        exportado_em: chrono::Utc::now().to_rfc3339(),
        icon: instancia.icon.clone(),
    };

    // Criar o zip
    let arquivo_zip = std::fs::File::create(&caminho_zip)
        .map_err(|e| format!("Erro ao criar arquivo zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(arquivo_zip);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Adicionar manifesto
    let manifesto_json = serde_json::to_string_pretty(&manifesto)
        .map_err(|e| format!("Erro ao serializar manifesto: {}", e))?;
    zip.start_file("dome_manifest.json", options)
        .map_err(|e| format!("Erro ao criar manifesto no zip: {}", e))?;
    use std::io::Write;
    zip.write_all(manifesto_json.as_bytes())
        .map_err(|e| format!("Erro ao escrever manifesto: {}", e))?;

    // Adicionar instance.json original
    let instance_json_path = instancia.path.join("instance.json");
    if instance_json_path.exists() {
        let dados = std::fs::read(&instance_json_path)
            .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;
        zip.start_file("instance.json", options)
            .map_err(|e| format!("Erro ao adicionar instance.json: {}", e))?;
        zip.write_all(&dados)
            .map_err(|e| format!("Erro ao escrever instance.json: {}", e))?;
    }

    // Pastas do jogo para incluir
    let mut pastas = vec![
        "mods",
        "resourcepacks",
        "shaderpacks",
        "config",
        "defaultconfigs",
        "kubejs",
        "scripts"
    ];
    if incluir_saves {
        pastas.push("saves");
    }
    for pasta in pastas {
        let caminho_pasta = instancia.path.join(pasta);
        adicionar_diretorio_ao_zip(&mut zip, &caminho_pasta, pasta, options)?;
    }

    // Arquivos avulsos
    let arquivos_avulsos = [
        "options.txt", "optionsof.txt", "optionsshaders.txt",
        "servers.dat",
    ];
    for arquivo in arquivos_avulsos {
        let caminho = instancia.path.join(arquivo);
        if caminho.exists() && caminho.is_file() {
            let dados = std::fs::read(&caminho)
                .map_err(|e| format!("Erro ao ler {}: {}", arquivo, e))?;
            zip.start_file(arquivo, options)
                .map_err(|e| format!("Erro ao adicionar {}: {}", arquivo, e))?;
            zip.write_all(&dados)
                .map_err(|e| format!("Erro ao escrever {}: {}", arquivo, e))?;
        }
    }

    zip.finish()
        .map_err(|e| format!("Erro ao finalizar arquivo zip: {}", e))?;

    Ok(ResultadoExportacao {
        sucesso: true,
        caminho_arquivo: Some(caminho_zip.to_string_lossy().to_string()),
        mensagem: format!("Instância exportada como {}", nome_arquivo),
    })
}

pub(crate) fn exportar_instancia_social_sem_saves(
    state: &LauncherState,
    instance_id: &str,
) -> Result<ResultadoExportacao, String> {
    let pasta_temp = std::env::temp_dir()
        .join("dome-social-sync")
        .join("outgoing");
    if !pasta_temp.exists() {
        std::fs::create_dir_all(&pasta_temp)
            .map_err(|e| format!("Erro ao criar pasta temporaria de sync social: {}", e))?;
    }

    exportar_instancia_interno(
        state,
        instance_id,
        Some(pasta_temp.to_string_lossy().as_ref()),
        false
    )
}

#[tauri::command]
pub(crate) async fn exportar_instancia(
    instance_id: String,
    destino: Option<String>,
    state: State<'_, LauncherState>,
) -> Result<ResultadoExportacao, String> {
    exportar_instancia_interno(&state, &instance_id, destino.as_deref(), true)
}

#[tauri::command]
pub(crate) async fn importar_instancia_arquivo(
    caminho_arquivo: String,
    state: State<'_, LauncherState>,
) -> Result<ResultadoImportacaoArquivo, String> {
    let caminho = std::path::PathBuf::from(caminho_arquivo.trim());
    if !caminho.exists() {
        return Err("Arquivo não encontrado.".to_string());
    }

    let arquivo = std::fs::File::open(&caminho)
        .map_err(|e| format!("Erro ao abrir arquivo: {}", e))?;
    let mut zip = zip::ZipArchive::new(arquivo)
        .map_err(|e| format!("Erro ao ler arquivo zip: {}", e))?;

    // Tentar ler o manifesto do Dome Launcher
    let manifesto: Option<ManifestoExportacao> = {
        match zip.by_name("dome_manifest.json") {
            Ok(mut entry) => {
                let mut conteudo = String::new();
                use std::io::Read;
                entry.read_to_string(&mut conteudo).ok();
                serde_json::from_str(&conteudo).ok()
            }
            Err(_) => None,
        }
    };

    // Se não tiver manifesto, tentar instance.json (import de outro launcher)
    let (nome, versao_mc, _mc_type, loader_type, loader_version) = if let Some(ref m) = manifesto {
        (
            m.nome.clone(),
            m.versao_minecraft.clone(),
            m.mc_type.clone(),
            m.loader_type.clone(),
            m.loader_version.clone(),
        )
    } else {
        // Tentar ler instance.json
        match zip.by_name("instance.json") {
            Ok(mut entry) => {
                let mut conteudo = String::new();
                use std::io::Read;
                entry.read_to_string(&mut conteudo).ok();
                match serde_json::from_str::<serde_json::Value>(&conteudo) {
                    Ok(json) => {
                        let nome = json["name"].as_str().unwrap_or("Importada").to_string();
                        let versao = json["version"].as_str().unwrap_or("").to_string();
                        let mc_type = json["mcType"]
                            .as_str()
                            .or(json["mc_type"].as_str())
                            .unwrap_or("vanilla")
                            .to_string();
                        let loader = json["loaderType"]
                            .as_str()
                            .or(json["loader_type"].as_str())
                            .map(String::from);
                        let loader_v = json["loaderVersion"]
                            .as_str()
                            .or(json["loader_version"].as_str())
                            .map(String::from);
                        (nome, versao, mc_type, loader, loader_v)
                    }
                    Err(_) => {
                        return Err(
                            "Arquivo zip inválido: não contém dome_manifest.json nem instance.json válido."
                                .to_string(),
                        )
                    }
                }
            }
            Err(_) => {
                return Err(
                    "Arquivo zip inválido: não contém dome_manifest.json nem instance.json."
                        .to_string(),
                )
            }
        }
    };

    if versao_mc.is_empty() {
        return Err("Versão do Minecraft não encontrada no arquivo.".to_string());
    }

    // Criar instância base
    let nome_unico = gerar_nome_instancia_unico(&state, &nome);
    let instancia_criada = criar_instancia_base_importada(
        &state,
        &nome_unico,
        &versao_mc,
        loader_type.as_deref(),
        loader_version.as_deref(),
    )
    .await?;

    // Extrair arquivos do zip para a pasta da instância
    // Reabrir o zip para extrair (o ZipArchive anterior foi consumido parcialmente)
    let arquivo = std::fs::File::open(&caminho)
        .map_err(|e| format!("Erro ao reabrir arquivo: {}", e))?;
    let mut zip = zip::ZipArchive::new(arquivo)
        .map_err(|e| format!("Erro ao reler arquivo zip: {}", e))?;

    // Itens que devemos extrair (ignorando manifesto e instance.json pois já usamos)
    for i in 0..zip.len() {
        let mut entry = match zip.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let nome_entrada = match entry.enclosed_name() {
            Some(n) => n.to_path_buf(),
            None => continue,
        };

        let nome_str = nome_entrada.to_string_lossy().to_string();
        // Pular manifesto e instance.json (já processados)
        if nome_str == "dome_manifest.json" || nome_str == "instance.json" {
            continue;
        }

        let destino = instancia_criada.path.join(&nome_entrada);

        if entry.is_dir() {
            std::fs::create_dir_all(&destino).ok();
        } else {
            if let Some(pai) = destino.parent() {
                std::fs::create_dir_all(pai).ok();
            }
            let mut arquivo_destino = std::fs::File::create(&destino)
                .map_err(|e| format!("Erro ao criar arquivo {}: {}", nome_str, e))?;
            std::io::copy(&mut entry, &mut arquivo_destino)
                .map_err(|e| format!("Erro ao extrair {}: {}", nome_str, e))?;
        }
    }

    Ok(ResultadoImportacaoArquivo {
        sucesso: true,
        instancia_id: Some(instancia_criada.id.clone()),
        mensagem: format!(
            "Instância '{}' importada com sucesso.",
            instancia_criada.name
        ),
    })
}

/// Permite escolher o caminho de destino via dialog nativo
#[tauri::command]
pub(crate) async fn escolher_pasta_exportacao() -> Result<Option<String>, String> {
    let downloads = std::env::var("USERPROFILE")
        .map(|p| std::path::PathBuf::from(p).join("Downloads"))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    Ok(Some(downloads.to_string_lossy().to_string()))
}

/// Selecionar arquivo para importar
#[tauri::command]
pub(crate) async fn escolher_arquivo_importacao() -> Result<Option<String>, String> {
    // Retorna None - a seleção real é feita no frontend via dialog nativo
    Ok(None)
}

// ===== FUNÇÃO PARA BUSCAR VERSÕES DOS LOADERS =====
