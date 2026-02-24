use super::*;

fn normalizar_loader_para_mods(loader: Option<&str>) -> Option<String> {
    let loader = loader?.trim().to_lowercase();
    match loader.as_str() {
        "vanilla" => None,
        "fabric" | "forge" | "neoforge" | "quilt" => Some(loader),
        _ => Some(loader),
    }
}

fn lista_str_de_json(valor: &serde_json::Value) -> Vec<String> {
    valor
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn loader_compativel(tags: &[String], loader_instancia: &Option<String>) -> bool {
    let loader_instancia = match loader_instancia {
        Some(loader) => loader,
        None => return true,
    };

    if tags.is_empty() {
        return true;
    }

    tags.iter().any(|t| t.eq_ignore_ascii_case(loader_instancia))
}

fn pontuar_tag_minecraft_curseforge(tag: &str, versao_instancia: &str) -> Option<i32> {
    if tag == versao_instancia {
        return Some(300);
    }

    let tag_numerica = tag.chars().all(|c| c.is_ascii_digit() || c == '.');
    if tag_numerica && tag.matches('.').count() == 1 && versao_instancia.starts_with(&format!("{}.", tag))
    {
        return Some(150);
    }

    None
}

fn extrair_tags_arquivo_curseforge(arquivo: &serde_json::Value) -> (Vec<String>, Vec<String>) {
    let game_versions = lista_str_de_json(&arquivo["gameVersions"]);
    let versoes_mc: Vec<String> = game_versions
        .iter()
        .filter(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .cloned()
        .collect();

    let tags_loader: Vec<String> = game_versions
        .iter()
        .filter(|s| {
            let s_lower = s.to_lowercase();
            matches!(s_lower.as_str(), "fabric" | "forge" | "neoforge" | "quilt")
        })
        .map(|s| s.to_lowercase())
        .collect();

    (versoes_mc, tags_loader)
}

fn nome_arquivo_valido_curseforge(tipo_conteudo: &str, nome_arquivo: &str) -> bool {
    let nome = nome_arquivo.to_lowercase();
    match tipo_conteudo {
        "mod" => nome.ends_with(".jar"),
        "resourcepack" | "shader" => nome.ends_with(".zip") || nome.ends_with(".jar"),
        _ => false,
    }
}

fn pontuar_arquivo_curseforge(
    arquivo: &serde_json::Value,
    tipo_conteudo: &str,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> Option<i32> {
    if !arquivo["isAvailable"].as_bool().unwrap_or(true) {
        return None;
    }

    let nome_arquivo = arquivo["fileName"].as_str().unwrap_or("");
    if !nome_arquivo_valido_curseforge(tipo_conteudo, nome_arquivo) {
        return None;
    }
    if !arquivo["downloadUrl"].is_string() {
        return None;
    }

    let (versoes_mc, tags_loader) = extrair_tags_arquivo_curseforge(arquivo);
    let mut score = 0;

    if versoes_mc.is_empty() {
        score += 40;
    } else {
        let melhor_mc = versoes_mc
            .iter()
            .filter_map(|tag| pontuar_tag_minecraft_curseforge(tag, versao_instancia))
            .max()?;
        score += melhor_mc;
    }

    if tipo_conteudo == "mod" {
        if let Some(loader) = loader_instancia {
            if tags_loader.is_empty() {
                score += 40;
            } else if tags_loader.iter().any(|tag| tag.eq_ignore_ascii_case(loader)) {
                score += 200;
            } else {
                return None;
            }
        }
    }

    let file_id = arquivo["id"].as_i64().unwrap_or(0) as i32;
    Some(score.saturating_mul(100_000) + file_id.max(0))
}

fn selecionar_arquivo_curseforge_compativel<'a>(
    arquivos: &'a [serde_json::Value],
    tipo_conteudo: &str,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> Option<&'a serde_json::Value> {
    arquivos
        .iter()
        .filter_map(|arquivo| {
            pontuar_arquivo_curseforge(arquivo, tipo_conteudo, versao_instancia, loader_instancia)
                .map(|score| (score, arquivo))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, arquivo)| arquivo)
}

fn versao_modrinth_compativel(
    versao: &serde_json::Value,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> bool {
    let versoes_mc = lista_str_de_json(&versao["game_versions"]);
    let loaders = lista_str_de_json(&versao["loaders"]);

    let versao_exata = versoes_mc.is_empty()
        || versoes_mc
            .iter()
            .any(|versao_mc| versao_mc == versao_instancia);

    versao_exata && loader_compativel(&loaders, loader_instancia)
}

fn url_arquivo_modrinth(versao: &serde_json::Value) -> Option<String> {
    let arquivos = versao["files"].as_array()?;
    if arquivos.is_empty() {
        return None;
    }

    if let Some(arquivo_primario_jar) = arquivos.iter().find(|f| {
        f["primary"].as_bool().unwrap_or(false)
            && f["filename"]
                .as_str()
                .is_some_and(|nome| nome.to_lowercase().ends_with(".jar"))
    }) {
        return arquivo_primario_jar["url"].as_str().map(|s| s.to_string());
    }

    if let Some(primeiro_jar) = arquivos.iter().find(|f| {
        f["filename"]
            .as_str()
            .is_some_and(|nome| nome.to_lowercase().ends_with(".jar"))
    }) {
        return primeiro_jar["url"].as_str().map(|s| s.to_string());
    }

    arquivos
        .first()
        .and_then(|f| f["url"].as_str().map(|s| s.to_string()))
}

#[tauri::command]
pub(crate) async fn install_mod(
    instance_id: String,
    mod_info: ModInfo,
    state: State<'_, LauncherState>,
) -> Result<(), String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mods_dir = instance.path.join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    let loader_instancia = normalizar_loader_para_mods(instance.loader_type.as_deref());
    let versao_instancia = instance.version.clone();

    // Para CurseForge, precisamos buscar a URL de download primeiro
    let download_url = if !mod_info.download_url.trim().is_empty() {
        mod_info.download_url.clone()
    } else if mod_info.platform == ModPlatform::CurseForge {
        // Buscar informações detalhadas do mod
        let mod_details_url = format!("{}/mods/{}", CURSEFORGE_API_BASE, mod_info.id);
        let details_request = anexar_headers_curseforge(client.get(&mod_details_url))?;
        let resposta_http = details_request
            .send()
            .await
            .map_err(|e| format!("Erro na requisição CurseForge: {}", e))?;

        if !resposta_http.status().is_success() {
            return Err(format!(
                "CurseForge retornou HTTP {} ao buscar mod {}",
                resposta_http.status().as_u16(),
                mod_info.id
            ));
        }

        let texto = resposta_http.text().await.map_err(|e| {
            format!("Erro ao ler corpo da resposta CurseForge: {}", e)
        })?;
        let details_response: serde_json::Value =
            serde_json::from_str(&texto).map_err(|e| {
                format!("Erro ao parsear JSON CurseForge: {}", e)
            })?;

        if let Some(latest_files) = details_response["data"]["latestFiles"].as_array() {
            if latest_files.is_empty() {
                return Err("Nenhum arquivo encontrado para este mod no CurseForge".to_string());
            }

            let arquivo_escolhido = selecionar_arquivo_curseforge_compativel(
                latest_files,
                "mod",
                &versao_instancia,
                &loader_instancia,
            )
            .ok_or_else(|| {
                format!(
                    "Nenhum arquivo CurseForge compatível com MC {} e loader {:?}",
                    versao_instancia, loader_instancia
                )
            })?;

            arquivo_escolhido["downloadUrl"]
                .as_str()
                .ok_or("Arquivo CurseForge compatível sem downloadUrl".to_string())?
                .to_string()
        } else {
            return Err("Campo 'latestFiles' não encontrado na resposta do CurseForge".to_string());
        }
    } else if mod_info.platform == ModPlatform::Modrinth {
        // Para Modrinth, buscar somente versões da instância (fluxo do app oficial).
        let game_versions_param =
            urlencoding::encode(&serde_json::json!([&versao_instancia]).to_string()).to_string();
        let mut version_url = format!(
            "{}/project/{}/version?game_versions={}",
            MODRINTH_API_BASE, mod_info.id, game_versions_param
        );
        if let Some(loader) = &loader_instancia {
            let loaders_param =
                urlencoding::encode(&serde_json::json!([loader]).to_string()).to_string();
            version_url.push_str(&format!("&loaders={}", loaders_param));
        }

        let version_response = client
            .get(&version_url)
            .header("User-Agent", "HeliosLauncher/1.0")
            .send()
            .await
            .map_err(|e| format!("Erro na requisição Modrinth: {}", e))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Erro ao parsear resposta Modrinth: {}", e))?;

        if let Some(versions) = version_response.as_array() {
            if versions.is_empty() {
                return Err("Nenhuma versão encontrada para este mod".to_string());
            }

            let versao_compativel = versions
                .iter()
                .find(|v| versao_modrinth_compativel(v, &versao_instancia, &loader_instancia))
                .ok_or_else(|| {
                    format!(
                        "Nenhuma versão Modrinth compatível com MC {} e loader {:?}",
                        versao_instancia, loader_instancia
                    )
                })?;

            url_arquivo_modrinth(versao_compativel)
                .ok_or("Nenhum arquivo válido encontrado na versão compatível".to_string())?
        } else {
            return Err("Resposta da API Modrinth não é um array de versões".to_string());
        }
    } else {
        return Err("Plataforma não suportada para download".to_string());
    };

    // Download do arquivo
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let file_name = if mod_info.file_name.is_empty() {
        format!("{}.jar", mod_info.name.replace(" ", "_"))
    } else {
        mod_info.file_name.clone()
    };

    let file_path = mods_dir.join(file_name);
    std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn install_project_file(
    instance_id: String,
    project_type: String,
    download_url: String,
    file_name: String,
    state: State<'_, LauncherState>,
) -> Result<(), String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;

    baixar_arquivo_para_pasta(
        &pasta_destino,
        &tipo_normalizado,
        download_url,
        file_name,
        "projeto",
    )
    .await
}

fn pasta_destino_conteudo(
    instance: &Instance,
    tipo_normalizado: &str,
) -> Result<std::path::PathBuf, String> {
    match tipo_normalizado {
        "mod" => Ok(instance.path.join("mods")),
        "resourcepack" => Ok(instance.path.join("resourcepacks")),
        "shader" => Ok(instance.path.join("shaderpacks")),
        _ => Err(format!(
            "Tipo de projeto não suportado para instalação: {}",
            tipo_normalizado
        )),
    }
}

async fn baixar_arquivo_para_pasta(
    pasta_destino: &std::path::Path,
    tipo_normalizado: &str,
    download_url: String,
    file_name: String,
    prefixo_fallback: &str,
) -> Result<(), String> {
    std::fs::create_dir_all(pasta_destino).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;
    let resposta = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar arquivo do projeto: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "Download do projeto falhou com status {}",
            resposta.status()
        ));
    }

    let bytes = resposta
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes do projeto: {}", e))?;

    let extensao_padrao = if tipo_normalizado == "mod" { ".jar" } else { ".zip" };
    let nome_sugerido = if file_name.trim().is_empty() {
        let sem_query = download_url.split('?').next().unwrap_or_default();
        sem_query
            .rsplit('/')
            .next()
            .filter(|nome| !nome.is_empty())
            .map(|nome| nome.to_string())
            .unwrap_or_else(|| {
                format!(
                    "{}_{}{}",
                    prefixo_fallback,
                    chrono::Utc::now().timestamp_millis(),
                    extensao_padrao
                )
            })
    } else {
        file_name.trim().to_string()
    };

    let nome_arquivo_final = std::path::Path::new(&nome_sugerido)
        .file_name()
        .and_then(|nome| nome.to_str())
        .filter(|nome| !nome.is_empty())
        .map(|nome| nome.to_string())
        .unwrap_or_else(|| {
            format!(
                "{}_{}{}",
                prefixo_fallback,
                chrono::Utc::now().timestamp_millis(),
                extensao_padrao
            )
        });

    let caminho_arquivo = pasta_destino.join(nome_arquivo_final);
    std::fs::write(caminho_arquivo, bytes).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagemGaleriaProjetoCurseforge {
    url: String,
    raw_url: Option<String>,
    title: Option<String>,
    description: Option<String>,
    featured: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetalhesProjetoCurseforge {
    id: String,
    title: String,
    description: String,
    body: String,
    icon_url: String,
    author: String,
    slug: String,
    downloads: Option<u64>,
    categorias: Vec<String>,
    galeria: Vec<ImagemGaleriaProjetoCurseforge>,
}

#[tauri::command]
pub(crate) async fn buscar_detalhes_projeto_curseforge(
    project_id: String,
) -> Result<DetalhesProjetoCurseforge, String> {
    let client = reqwest::Client::new();
    let detalhes_url = format!("{}/mods/{}", CURSEFORGE_API_BASE, project_id);
    let request = anexar_headers_curseforge(client.get(&detalhes_url))?;
    let resposta = request
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar detalhes do CurseForge: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou erro ao buscar detalhes: {}",
            resposta.status()
        ));
    }

    let payload: serde_json::Value = resposta
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear detalhes do CurseForge: {}", e))?;
    let dados = &payload["data"];

    if dados.is_null() {
        return Err("Resposta do CurseForge sem dados do projeto.".to_string());
    }

    let id = dados["id"].as_u64().unwrap_or(0).to_string();
    let title = dados["name"].as_str().unwrap_or("").to_string();
    let description = dados["summary"].as_str().unwrap_or("").to_string();
    let icon_url = dados["logo"]["url"].as_str().unwrap_or("").to_string();
    let author = dados["authors"]
        .as_array()
        .and_then(|autores| autores.first())
        .and_then(|autor| autor["name"].as_str())
        .unwrap_or("Autor desconhecido")
        .to_string();

    let website_url = dados["links"]["websiteUrl"].as_str().unwrap_or("");
    let slug = dados["slug"]
        .as_str()
        .map(|valor| valor.to_string())
        .or_else(|| extrair_slug_de_url_curseforge(website_url))
        .unwrap_or_default();

    let categorias = dados["categories"]
        .as_array()
        .map(|itens| {
            itens
                .iter()
                .filter_map(|categoria| {
                    categoria["name"]
                        .as_str()
                        .map(|nome| nome.trim().to_string())
                        .filter(|nome| !nome.is_empty())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let galeria = dados["screenshots"]
        .as_array()
        .map(|itens| {
            itens
                .iter()
                .filter_map(|imagem| {
                    let url_completa = imagem["url"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty())?;
                    let url_thumb = imagem["thumbnailUrl"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty());

                    let title = imagem["title"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty());
                    let description = imagem["description"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty());

                    Some(ImagemGaleriaProjetoCurseforge {
                        url: url_thumb.unwrap_or_else(|| url_completa.clone()),
                        raw_url: Some(url_completa),
                        title,
                        description,
                        featured: false,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let description_url = format!("{}/mods/{}/description", CURSEFORGE_API_BASE, project_id);
    let request_description = anexar_headers_curseforge(client.get(&description_url))?;
    let resposta_description = request_description
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar descrição do CurseForge: {}", e))?;

    let body = if resposta_description.status().is_success() {
        let payload_descricao: serde_json::Value = resposta_description
            .json()
            .await
            .map_err(|e| format!("Erro ao parsear descrição do CurseForge: {}", e))?;
        payload_descricao["data"].as_str().unwrap_or("").to_string()
    } else {
        String::new()
    };

    Ok(DetalhesProjetoCurseforge {
        id,
        title,
        description,
        body,
        icon_url,
        author,
        slug,
        downloads: dados["downloadCount"].as_u64(),
        categorias,
        galeria,
    })
}

#[tauri::command]
pub(crate) async fn install_curseforge_project_file(
    instance_id: String,
    project_type: String,
    project_id: String,
    state: State<'_, LauncherState>,
) -> Result<(), String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;

    let client = reqwest::Client::new();
    let files_url = format!(
        "{}/mods/{}/files?pageSize=50&sortField=1&sortOrder=desc",
        CURSEFORGE_API_BASE, project_id
    );
    let request = anexar_headers_curseforge(client.get(&files_url))?;
    let resposta = request
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar arquivos do CurseForge: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou erro ao listar arquivos: {}",
            resposta.status()
        ));
    }

    let texto_resposta = resposta
        .text()
        .await
        .map_err(|e| format!("Erro ao ler corpo da resposta CurseForge: {}", e))?;
    let payload: serde_json::Value =
        serde_json::from_str(&texto_resposta).map_err(|e| {
            format!("Erro ao parsear JSON CurseForge: {}", e)
        })?;

    let arquivos = payload["data"]
        .as_array()
        .ok_or("Resposta inválida do CurseForge (data ausente)")?;

    let loader_instancia = normalizar_loader_para_mods(instance.loader_type.as_deref());
    let versao_instancia = instance.version.clone();

    let arquivo_escolhido = selecionar_arquivo_curseforge_compativel(
        arquivos,
        &tipo_normalizado,
        &versao_instancia,
        &loader_instancia,
    )
    .ok_or_else(|| {
        format!(
            "Nenhum arquivo CurseForge compatível com MC {} para o tipo {}.",
            versao_instancia, tipo_normalizado
        )
    })?;

    let download_url = arquivo_escolhido["downloadUrl"]
        .as_str()
        .ok_or("Arquivo selecionado do CurseForge sem URL de download")?
        .to_string();
    let nome_arquivo = arquivo_escolhido["fileName"]
        .as_str()
        .unwrap_or("")
        .to_string();

    baixar_arquivo_para_pasta(
        &pasta_destino,
        &tipo_normalizado,
        download_url,
        nome_arquivo,
        "curseforge",
    )
    .await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DadosInstalacaoModpackCurseforge {
    nome_modpack: String,
    versao_modpack: String,
    versao_minecraft: String,
    loader_type: String,
    download_url: String,
    file_name: String,
}

fn arquivo_modpack_curseforge_valido(arquivo: &serde_json::Value) -> bool {
    let nome = arquivo["fileName"].as_str().unwrap_or("").to_lowercase();
    if !nome.ends_with(".zip") {
        return false;
    }
    arquivo["downloadUrl"]
        .as_str()
        .map(|u| !u.trim().is_empty())
        .unwrap_or(false)
}

fn escolher_arquivo_modpack_curseforge<'a>(
    arquivos: &'a [serde_json::Value],
) -> Option<&'a serde_json::Value> {
    arquivos.iter().find(|arquivo| arquivo_modpack_curseforge_valido(arquivo))
}

#[tauri::command]
pub(crate) async fn resolver_modpack_curseforge(
    project_id: String,
) -> Result<DadosInstalacaoModpackCurseforge, String> {
    let client = reqwest::Client::new();
    let files_url = format!(
        "{}/mods/{}/files?pageSize=50&sortField=1&sortOrder=desc",
        CURSEFORGE_API_BASE, project_id
    );
    let request = anexar_headers_curseforge(client.get(&files_url))?;
    let resposta = request
        .send()
        .await
        .map_err(|e| format!("Erro ao listar arquivos do modpack CurseForge: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou erro ao listar modpack: {}",
            resposta.status()
        ));
    }

    let payload: serde_json::Value = resposta
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta do CurseForge: {}", e))?;
    let arquivos = payload["data"]
        .as_array()
        .ok_or("Resposta do CurseForge sem lista de arquivos.")?;

    let arquivo = escolher_arquivo_modpack_curseforge(arquivos)
        .ok_or("Nenhum arquivo de modpack CurseForge com download disponível foi encontrado.")?;

    let download_url = arquivo["downloadUrl"]
        .as_str()
        .ok_or("Arquivo de modpack sem URL de download.")?
        .to_string();
    let file_name = arquivo["fileName"]
        .as_str()
        .filter(|nome| !nome.trim().is_empty())
        .unwrap_or("modpack.zip")
        .to_string();

    let mut nome_modpack = arquivo["displayName"]
        .as_str()
        .filter(|nome| !nome.trim().is_empty())
        .unwrap_or("Modpack CurseForge")
        .to_string();
    let mut versao_modpack = arquivo["displayName"]
        .as_str()
        .filter(|nome| !nome.trim().is_empty())
        .unwrap_or("latest")
        .to_string();

    let (versoes_mc, loaders_tags) = extrair_tags_arquivo_curseforge(arquivo);
    let mut versao_minecraft = versoes_mc.first().cloned();
    let mut loader_type = loaders_tags
        .first()
        .cloned()
        .unwrap_or_else(|| "vanilla".to_string());

    let bytes = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar modpack CurseForge: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes do modpack CurseForge: {}", e))?;

    let cursor = std::io::Cursor::new(bytes.to_vec());
    if let Ok(mut archive) = zip::ZipArchive::new(cursor) {
        if let Ok(mut manifesto) = archive.by_name("manifest.json") {
            let mut conteudo = String::new();
            if std::io::Read::read_to_string(&mut manifesto, &mut conteudo).is_ok() {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&conteudo) {
                    if let Some(nome) = json["name"].as_str().filter(|nome| !nome.trim().is_empty())
                    {
                        nome_modpack = nome.to_string();
                    }

                    if let Some(versao) = json["version"].as_str() {
                        if !versao.trim().is_empty() {
                            versao_modpack = versao.to_string();
                        }
                    } else if let Some(versao_num) = json["version"].as_i64() {
                        versao_modpack = versao_num.to_string();
                    }

                    if let Some(versao_mc) = json["minecraft"]["version"].as_str() {
                        if !versao_mc.trim().is_empty() {
                            versao_minecraft = Some(versao_mc.to_string());
                        }
                    }

                    if let Some(loaders) = json["minecraft"]["modLoaders"].as_array() {
                        for loader in loaders {
                            let id_loader = loader["id"]
                                .as_str()
                                .or_else(|| loader.as_str())
                                .unwrap_or("");
                            if let Some(loader_normalizado) =
                                detectar_loader_normalizado(Some(id_loader))
                            {
                                loader_type = loader_normalizado;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let versao_minecraft = versao_minecraft
        .filter(|versao| !versao.trim().is_empty())
        .ok_or("Não foi possível detectar a versão do Minecraft do modpack CurseForge.")?;

    if !matches!(loader_type.as_str(), "forge" | "fabric" | "neoforge") {
        loader_type = "vanilla".to_string();
    }

    Ok(DadosInstalacaoModpackCurseforge {
        nome_modpack,
        versao_modpack,
        versao_minecraft,
        loader_type,
        download_url,
        file_name,
    })
}

#[tauri::command]
pub(crate) fn get_installed_mods(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<String>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mods_dir = instance.path.join("mods");

    if !mods_dir.exists() {
        return Ok(vec![]);
    }

    let mut mods = vec![];
    if let Ok(entries) = std::fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".jar") || file_name.ends_with(".jar.disabled") {
                    mods.push(file_name.to_string());
                }
            }
        }
    }

    Ok(mods)
}

#[tauri::command]
pub(crate) fn get_installed_resourcepacks(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<String>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let resourcepacks_dir = instance.path.join("resourcepacks");

    if !resourcepacks_dir.exists() {
        return Ok(vec![]);
    }

    let mut packs = vec![];
    if let Ok(entries) = std::fs::read_dir(resourcepacks_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".zip")
                    || file_name.ends_with(".zip.disabled")
                    || entry.path().is_dir()
                {
                    packs.push(file_name.to_string());
                }
            }
        }
    }

    Ok(packs)
}

#[tauri::command]
pub(crate) fn get_installed_shaders(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<String>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let shaders_dir = instance.path.join("shaderpacks");

    if !shaders_dir.exists() {
        return Ok(vec![]);
    }

    let mut shaders = vec![];
    if let Ok(entries) = std::fs::read_dir(shaders_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".zip")
                    || file_name.ends_with(".zip.disabled")
                    || entry.path().is_dir()
                {
                    shaders.push(file_name.to_string());
                }
            }
        }
    }

    Ok(shaders)
}

#[tauri::command]
pub(crate) fn remove_mod(
    instance_id: String,
    mod_file: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mod_path = instance.path.join("mods").join(mod_file);
    std::fs::remove_file(mod_path).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn remove_project_file(
    instance_id: String,
    project_type: String,
    file_name: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;

    let nome_seguro = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nome de arquivo inválido para remoção.")?
        .to_string();

    if nome_seguro.is_empty() {
        return Err("Nome de arquivo vazio para remoção.".to_string());
    }

    let caminho_alvo = pasta_destino.join(&nome_seguro);
    if !caminho_alvo.exists() {
        return Ok(());
    }

    let caminho_validado = validar_caminho_dentro_raiz(&pasta_destino, &caminho_alvo)?;
    if caminho_validado.is_dir() {
        std::fs::remove_dir_all(caminho_validado).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(caminho_validado).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn toggle_project_file_enabled(
    instance_id: String,
    project_type: String,
    file_name: String,
    enabled: bool,
    state: State<LauncherState>,
) -> Result<String, String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;

    let nome_seguro = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nome de arquivo inválido para alterar estado.")?
        .to_string();

    if nome_seguro.is_empty() {
        return Err("Nome de arquivo vazio para alterar estado.".to_string());
    }

    let nome_habilitado = if nome_seguro.ends_with(".disabled") {
        nome_seguro.trim_end_matches(".disabled").to_string()
    } else {
        nome_seguro.clone()
    };
    let nome_desabilitado = if nome_habilitado.ends_with(".disabled") {
        nome_habilitado.clone()
    } else {
        format!("{}.disabled", nome_habilitado)
    };

    let origem_nome = if enabled {
        nome_desabilitado.clone()
    } else {
        nome_habilitado.clone()
    };
    let destino_nome = if enabled {
        nome_habilitado.clone()
    } else {
        nome_desabilitado.clone()
    };

    let caminho_origem = pasta_destino.join(&origem_nome);
    let caminho_destino = pasta_destino.join(&destino_nome);

    if caminho_destino.exists() && !caminho_origem.exists() {
        return Ok(destino_nome);
    }
    if !caminho_origem.exists() {
        return Err(format!(
            "Arquivo '{}' não encontrado para alterar estado.",
            origem_nome
        ));
    }

    let origem_validada = validar_caminho_dentro_raiz(&pasta_destino, &caminho_origem)?;
    let _ = validar_caminho_dentro_raiz(
        &pasta_destino,
        caminho_destino.parent().unwrap_or(&pasta_destino),
    )?;

    std::fs::rename(origem_validada, &caminho_destino)
        .map_err(|e| format!("Falha ao alternar estado do arquivo: {}", e))?;

    Ok(destino_nome)
}

// ===== FUNÇÕES DE BUSCA DE MODS =====

fn normalizar_tipo_conteudo(tipo: Option<String>) -> String {
    let normalizado = tipo
        .unwrap_or_else(|| "mod".to_string())
        .trim()
        .to_lowercase();

    match normalizado.as_str() {
        "modpack" | "resourcepack" | "shader" => normalizado,
        _ => "mod".to_string(),
    }
}

#[tauri::command]
pub(crate) async fn search_mods_online(
    query: String,
    platform: Option<ModPlatform>,
    content_type: Option<String>,
) -> Result<Vec<ModSearchResult>, String> {
    let tipo_conteudo = normalizar_tipo_conteudo(content_type);
    let client = reqwest::Client::new();
    let mut results = Vec::new();
    let mut erros = Vec::new();

    // Se não especificar plataforma, buscar em ambas
    let platforms_to_search = match platform {
        Some(p) => vec![p],
        None => vec![ModPlatform::CurseForge, ModPlatform::Modrinth],
    };

    for platform in platforms_to_search {
        match platform {
            ModPlatform::CurseForge => {
                match search_curseforge_conteudo(&client, &query, &tipo_conteudo).await {
                    Ok(mut curseforge_results) => results.append(&mut curseforge_results),
                    Err(e) => {
                        eprintln!("Erro ao buscar no CurseForge: {}", e);
                        erros.push(format!("CurseForge: {}", e));
                    }
                }
            }
            ModPlatform::Modrinth => {
                match search_modrinth_conteudo(&client, &query, &tipo_conteudo).await {
                    Ok(mut modrinth_results) => results.append(&mut modrinth_results),
                    Err(e) => {
                        eprintln!("Erro ao buscar no Modrinth: {}", e);
                        erros.push(format!("Modrinth: {}", e));
                    }
                }
            }
            ModPlatform::FTB => {
                // FTB pode ser implementado futuramente
                continue;
            }
        }
    }

    // Ordenar por popularidade (downloads)
    results.sort_by(|a, b| {
        let a_downloads = a.download_count.unwrap_or(0);
        let b_downloads = b.download_count.unwrap_or(0);
        b_downloads.cmp(&a_downloads)
    });

    if results.is_empty() && !erros.is_empty() {
        return Err(erros.join(" | "));
    }

    Ok(results)
}

async fn search_curseforge_conteudo(
    client: &reqwest::Client,
    query: &str,
    tipo_conteudo: &str,
) -> Result<Vec<ModSearchResult>, String> {
    let class_id = class_id_por_tipo_conteudo(tipo_conteudo);
    let search_url = format!(
        "{}/mods/search?gameId=432&searchFilter={}&classId={}&pageSize=20&sortField=2&sortOrder=desc",
        CURSEFORGE_API_BASE,
        urlencoding::encode(query),
        class_id
    );

    let request = anexar_headers_curseforge(client.get(&search_url))?;
    let resposta_http = request
        .send()
        .await
        .map_err(|e| format!("Erro na busca CurseForge: {}", e))?;

    if !resposta_http.status().is_success() {
        let status = resposta_http.status();
        let corpo = resposta_http.text().await.unwrap_or_default();
        let trecho: String = corpo.chars().take(200).collect();
        let dica_key = if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            format!(
                " Verifique a chave da API (CURSEFORGE_API_KEY ou fallback configurado no backend)."
            )
        } else {
            String::new()
        };
        return Err(format!(
            "CurseForge retornou HTTP {} — {}{}",
            status.as_u16(),
            trecho,
            dica_key
        ));
    }

    let texto_corpo = resposta_http.text().await.map_err(|e| {
        format!("Erro ao ler corpo da resposta CurseForge: {}", e)
    })?;
    let response: serde_json::Value = serde_json::from_str(&texto_corpo).map_err(|e| {
        let trecho: String = texto_corpo.chars().take(200).collect();
        format!(
            "Erro ao parsear JSON CurseForge: {} — Corpo: {}",
            e, trecho
        )
    })?;

    let mut results = Vec::new();

    if let Some(data) = response["data"].as_array() {
        for mod_data in data {
            let id = mod_data["id"].as_u64().unwrap_or(0).to_string();
            let name = mod_data["name"]
                .as_str()
                .unwrap_or("Nome desconhecido")
                .to_string();
            let summary = mod_data["summary"].as_str().unwrap_or("").to_string();
            let authors = mod_data["authors"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|author| author["name"].as_str())
                .unwrap_or("Autor desconhecido")
                .to_string();

            let download_count = mod_data["downloadCount"].as_u64();
            let logo = mod_data["logo"]["url"].as_str().map(|s| s.to_string());
            let website_url = mod_data["links"]["websiteUrl"]
                .as_str()
                .unwrap_or(&format!(
                    "https://www.curseforge.com/minecraft/{}/{}",
                    rota_curseforge_por_tipo_conteudo(tipo_conteudo),
                    id,
                ))
                .to_string();
            let slug = mod_data["slug"]
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| extrair_slug_de_url_curseforge(&website_url));

            results.push(ModSearchResult {
                id,
                name,
                description: summary,
                author: authors,
                platform: ModPlatform::CurseForge,
                download_count,
                icon_url: logo,
                project_url: website_url,
                latest_version: None, // CurseForge não retorna versão na busca básica
                slug,
                project_type: Some(tipo_conteudo.to_string()),
                file_name: None,
            });
        }
    }
    Ok(results)
}

async fn search_modrinth_conteudo(
    client: &reqwest::Client,
    query: &str,
    tipo_conteudo: &str,
) -> Result<Vec<ModSearchResult>, String> {
    let search_url = format!(
        "{}/search?query={}&facets=[[\"project_type:{}\"]]&limit=20",
        MODRINTH_API_BASE,
        urlencoding::encode(query),
        tipo_conteudo
    );

    let response = client
        .get(&search_url)
        .header("User-Agent", "HeliosLauncher/1.0")
        .send()
        .await
        .map_err(|e| format!("Erro na busca Modrinth: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Erro ao parsear resposta Modrinth: {}", e))?;

    let mut results = Vec::new();

    if let Some(hits) = response["hits"].as_array() {
        for hit in hits {
            let id = hit["project_id"].as_str().unwrap_or("").to_string();
            let name = hit["title"]
                .as_str()
                .unwrap_or("Nome desconhecido")
                .to_string();
            let description = hit["description"].as_str().unwrap_or("").to_string();
            let author = hit["author"]
                .as_str()
                .unwrap_or("Autor desconhecido")
                .to_string();
            let slug = hit["slug"].as_str().map(|s| s.to_string());

            let download_count = hit["downloads"].as_u64();
            let icon_url = hit["icon_url"].as_str().map(|s| s.to_string());
            let project_url = if let Some(slug) = &slug {
                format!("https://modrinth.com/{}/{}", tipo_conteudo, slug)
            } else {
                format!("https://modrinth.com/{}/{}", tipo_conteudo, id)
            };

            results.push(ModSearchResult {
                id,
                name,
                description,
                author,
                platform: ModPlatform::Modrinth,
                download_count,
                icon_url,
                project_url,
                latest_version: hit["latest_version"].as_str().map(|s| s.to_string()),
                slug,
                project_type: Some(
                    hit["project_type"]
                        .as_str()
                        .unwrap_or(tipo_conteudo)
                        .to_string(),
                ),
                file_name: None,
            });
        }
    }
    Ok(results)
}

// ===== FUNÇÕES DE LOGS =====


// ===== ESTRUTURAS PARA BUSCA DE MODS =====

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModSearchResult {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub platform: ModPlatform,
    pub download_count: Option<u64>,
    pub icon_url: Option<String>,
    pub project_url: String,
    pub latest_version: Option<String>,
    pub slug: Option<String>,
    pub project_type: Option<String>,
    pub file_name: Option<String>,
}

