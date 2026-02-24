use serde::{Deserialize, Serialize};

// ===== GERENCIAMENTO AUTOMÁTICO DE JAVA =====
// Inspirado no HeliosLauncher (JavaGuard): detecta instalações, valida versões,
// baixa do Adoptium automaticamente quando necessário

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JavaInfo {
    pub path: String,
    pub version: String,
    pub major: u32,
    pub vendor: String,
    pub arch: String,
    pub is_managed: bool, // true = instalado pelo launcher
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct GlobalSettings {
    pub ram_mb: u32,
    pub java_path: Option<String>,
    pub java_args: String,
    pub width: u32,
    pub height: u32,
    pub auto_java: bool,       // gerenciamento automático de Java
    pub close_on_launch: bool, // fechar launcher ao iniciar jogo
    pub show_snapshots: bool,  // mostrar snapshots na lista de versões
    pub discord_rpc_ativo: bool,
    pub cor_destaque: String,
}

impl Default for GlobalSettings {
    fn default() -> Self {
        // Detectar RAM total do sistema para sugerir um padrão razoável
        let total_ram_mb = {
            let sys = sysinfo::System::new_with_specifics(
                sysinfo::RefreshKind::new().with_memory(sysinfo::MemoryRefreshKind::everything()),
            );
            (sys.total_memory() / 1024 / 1024) as u32
        };
        // Padrão: 25% da RAM, mínimo 2GB, máximo 8GB
        let default_ram = (total_ram_mb / 4).max(2048).min(8192);

        Self {
            ram_mb: default_ram,
            java_path: None,
            java_args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200"
                .to_string(),
            width: 854,
            height: 480,
            auto_java: true,
            close_on_launch: false,
            show_snapshots: false,
            discord_rpc_ativo: true,
            cor_destaque: "verde".to_string(),
        }
    }
}

fn get_settings_path() -> std::path::PathBuf {
    std::env::var("APPDATA")
        .map(|app_data| {
            std::path::PathBuf::from(app_data)
                .join("dome")
                .join("settings.json")
        })
        .unwrap_or_else(|_| std::path::PathBuf::from("settings.json"))
}

fn get_runtime_dir() -> std::path::PathBuf {
    std::env::var("APPDATA")
        .map(|app_data| {
            std::path::PathBuf::from(app_data)
                .join("dome")
                .join("runtime")
        })
        .unwrap_or_else(|_| std::path::PathBuf::from("runtime"))
}

#[tauri::command]
pub async fn get_settings() -> Result<GlobalSettings, String> {
    let path = get_settings_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Erro ao ler configurações: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Erro ao parsear configurações: {}", e))
    } else {
        Ok(GlobalSettings::default())
    }
}

#[tauri::command]
pub async fn save_settings(settings: GlobalSettings) -> Result<(), String> {
    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Erro ao criar diretório: {}", e))?;
    }
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Erro ao serializar: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Erro ao salvar: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_system_ram() -> Result<u32, String> {
    let sys = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::new().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    Ok((sys.total_memory() / 1024 / 1024) as u32)
}

/// Detecta todas as instalações de Java no sistema (estilo HeliosLauncher)
#[tauri::command]
pub async fn detect_java_installations() -> Result<Vec<JavaInfo>, String> {
    let mut javas: Vec<JavaInfo> = Vec::new();
    let mut checked_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1. Verificar runtime gerenciado pelo launcher
    let runtime_dir = get_runtime_dir();
    if runtime_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&runtime_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let java_exe = entry.path().join("bin").join("javaw.exe");
                    let java_exe_alt = entry.path().join("bin").join("java.exe");
                    let exe = if java_exe.exists() {
                        java_exe
                    } else {
                        java_exe_alt
                    };
                    if exe.exists() {
                        let path_str = entry.path().to_string_lossy().to_string();
                        if checked_paths.insert(path_str.clone()) {
                            if let Some(info) = probe_java(&exe, true).await {
                                javas.push(info);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Verificar JAVA_HOME e outras variáveis de ambiente
    for env_key in &["JAVA_HOME", "JRE_HOME", "JDK_HOME"] {
        if let Ok(val) = std::env::var(env_key) {
            let java_exe = std::path::PathBuf::from(&val).join("bin").join("java.exe");
            if java_exe.exists() && checked_paths.insert(val.clone()) {
                if let Some(info) = probe_java(&java_exe, false).await {
                    javas.push(info);
                }
            }
        }
    }

    // 3. Verificar pastas padrão do Windows
    let drive_letters = vec!["C", "D", "E"];
    let search_dirs = vec![
        "Program Files\\Java",
        "Program Files\\Eclipse Adoptium",
        "Program Files\\Eclipse Foundation",
        "Program Files\\AdoptOpenJDK",
        "Program Files\\Amazon Corretto",
        "Program Files\\Microsoft",
        "Program Files\\Zulu",
    ];

    for drive in &drive_letters {
        for dir in &search_dirs {
            let base = std::path::PathBuf::from(format!("{}:\\{}", drive, dir));
            if base.exists() {
                if let Ok(entries) = std::fs::read_dir(&base) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() {
                            let java_exe = entry.path().join("bin").join("java.exe");
                            let path_str = entry.path().to_string_lossy().to_string();
                            if java_exe.exists() && checked_paths.insert(path_str.clone()) {
                                if let Some(info) = probe_java(&java_exe, false).await {
                                    javas.push(info);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Verificar se "java" está no PATH
    if let Ok(output) = tokio::process::Command::new("java")
        .arg("-version")
        .output()
        .await
    {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Some(info) = parse_java_version_output(&stderr, "java", false) {
            // Verificar se não é duplicata
            if !javas
                .iter()
                .any(|j| j.version == info.version && j.vendor == info.vendor)
            {
                javas.push(info);
            }
        }
    }

    // Ordenar: managed primeiro, depois por versão major (maior primeiro)
    javas.sort_by(|a, b| b.is_managed.cmp(&a.is_managed).then(b.major.cmp(&a.major)));

    Ok(javas)
}

/// Obter a versão do Java necessária para uma versão do Minecraft
fn get_required_java_major(mc_version: &str) -> u32 {
    // Parse versão MC (ex: "1.21.4" -> [1, 21, 4])
    let parts: Vec<u32> = mc_version
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();

    let (major, minor) = match parts.as_slice() {
        [m, n, ..] => (*m, *n),
        [m] => (*m, 0),
        _ => (1, 0),
    };

    if major >= 1 {
        if minor >= 21 {
            return 21;
        } // 1.21+ = Java 21
        if minor >= 18 {
            return 17;
        } // 1.18+ = Java 17
        if minor >= 17 {
            return 16;
        } // 1.17 = Java 16
        return 8; // 1.16 e anteriores = Java 8
    }
    8
}

/// Probar un ejecutable de Java para obtener info de versión
pub async fn probe_java(exe_path: &std::path::Path, is_managed: bool) -> Option<JavaInfo> {
    let output = tokio::process::Command::new(exe_path)
        .arg("-version")
        .output()
        .await
        .ok()?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_java_version_output(
        &stderr,
        &exe_path.parent()?.parent()?.to_string_lossy(),
        is_managed,
    )
}

/// Parsear a saída de `java -version`
fn parse_java_version_output(output: &str, path: &str, is_managed: bool) -> Option<JavaInfo> {
    // Linha 1: java/openjdk version "VERSION"
    let first_line = output.lines().next()?;

    // Extrair versão entre aspas
    let version_str = first_line.split('"').nth(1)?;

    // Parsear major version
    let major = if version_str.starts_with("1.") {
        // Java 8: "1.8.0_xxx"
        version_str.split('.').nth(1)?.parse::<u32>().ok()?
    } else {
        // Java 9+: "17.0.5", "21.0.1"
        version_str.split('.').next()?.parse::<u32>().ok()?
    };

    // Detectar vendor
    let vendor = if output.contains("Eclipse Adoptium") || output.contains("Temurin") {
        "Eclipse Adoptium".to_string()
    } else if output.contains("Corretto") {
        "Amazon Corretto".to_string()
    } else if output.contains("Zulu") {
        "Azul Zulu".to_string()
    } else if output.contains("GraalVM") {
        "GraalVM".to_string()
    } else if output.contains("Oracle") {
        "Oracle".to_string()
    } else if output.contains("Microsoft") {
        "Microsoft".to_string()
    } else {
        "OpenJDK".to_string()
    };

    // Detectar arquitetura
    let arch = if output.contains("64-Bit") || output.contains("amd64") || output.contains("x86_64")
    {
        "x64".to_string()
    } else if output.contains("aarch64") {
        "arm64".to_string()
    } else {
        "x86".to_string()
    };

    Some(JavaInfo {
        path: path.to_string(),
        version: version_str.to_string(),
        major,
        vendor,
        arch,
        is_managed,
    })
}

/// Baixar e instalar Java automaticamente do Adoptium
#[tauri::command]
pub async fn install_java(major: u32) -> Result<JavaInfo, String> {
    let client = reqwest::Client::new();
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    };
    let os = "windows";

    println!(
        "[Java] Buscando JDK {} do Adoptium ({} {})...",
        major, os, arch
    );

    // Buscar binário mais recente
    let api_url = format!(
        "https://api.adoptium.net/v3/assets/latest/{}/hotspot?vendor=eclipse",
        major
    );

    let res: Vec<serde_json::Value> = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar JDK: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta: {}", e))?;

    // Encontrar o binário correto (JDK, Windows, x64)
    let target = res
        .iter()
        .find(|entry| {
            let binary = &entry["binary"];
            binary["os"].as_str() == Some(os)
                && binary["architecture"].as_str() == Some(arch)
                && binary["image_type"].as_str() == Some("jdk")
        })
        .ok_or_else(|| format!("JDK {} não encontrado para {} {}", major, os, arch))?;

    let download_url = target["binary"]["package"]["link"]
        .as_str()
        .ok_or("URL de download não encontrada")?;
    let file_name = target["binary"]["package"]["name"]
        .as_str()
        .ok_or("Nome do arquivo não encontrado")?;
    let file_size = target["binary"]["package"]["size"].as_u64().unwrap_or(0);

    println!(
        "[Java] Baixando {} ({} MB)...",
        file_name,
        file_size / 1024 / 1024
    );

    // Baixar o arquivo
    let runtime_dir = get_runtime_dir();
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("Erro ao criar diretório runtime: {}", e))?;

    let archive_path = runtime_dir.join(file_name);

    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes: {}", e))?;

    std::fs::write(&archive_path, &bytes).map_err(|e| format!("Erro ao salvar arquivo: {}", e))?;

    println!("[Java] Extraindo {}...", file_name);

    // Extrair o ZIP
    let extract_dir = runtime_dir.clone();
    let file =
        std::fs::File::open(&archive_path).map_err(|e| format!("Erro ao abrir arquivo: {}", e))?;

    let mut zip_archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Erro ao abrir ZIP: {}", e))?;

    // Encontrar o nome da pasta raiz dentro do ZIP
    let root_folder = {
        let first = zip_archive
            .by_index(0)
            .map_err(|e| format!("ZIP vazio: {}", e))?;
        let name = first.name().to_string();
        name.split('/').next().unwrap_or("").to_string()
    };

    // Extrair
    for i in 0..zip_archive.len() {
        let mut entry = zip_archive
            .by_index(i)
            .map_err(|e| format!("Erro no ZIP: {}", e))?;
        let outpath = extract_dir.join(entry.name());

        if entry.is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("Erro ao criar arquivo: {}", e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Erro ao extrair: {}", e))?;
        }
    }

    // Limpar arquivo ZIP
    std::fs::remove_file(&archive_path).ok();

    // Verificar a instalação
    let java_home = extract_dir.join(&root_folder);
    let java_exe = java_home.join("bin").join("java.exe");

    if !java_exe.exists() {
        return Err(format!(
            "Java não encontrado após extração em {:?}",
            java_exe
        ));
    }

    println!(
        "[Java] JDK {} instalado com sucesso em {:?}",
        major, java_home
    );

    // Probar a instalação
    let info = probe_java(&java_exe, true)
        .await
        .ok_or("Falha ao verificar Java instalado")?;

    Ok(info)
}

/// Garantir que exista um Java adequado para a versão do MC
#[tauri::command]
pub async fn ensure_java_for_version(mc_version: String) -> Result<String, String> {
    let required_major = get_required_java_major(&mc_version);
    println!("[Java] MC {} requer Java {}", mc_version, required_major);

    // 1. Verificar configurações - se o usuário definiu um caminho manual
    let settings = get_settings().await.unwrap_or_default();
    if !settings.auto_java {
        if let Some(ref path) = settings.java_path {
            if !path.is_empty() {
                let java_exe = std::path::PathBuf::from(path).join("bin").join("java.exe");
                if java_exe.exists() {
                    return Ok(java_exe.to_string_lossy().to_string());
                }
            }
        }
        // Se desabilitou auto e não tem caminho, usar "java" do PATH
        return Ok("java".to_string());
    }

    // 2. Buscar nas instalações detectadas
    let installations = detect_java_installations().await?;

    // Procurar Java com major >= required (com preferência para exato)
    let best = installations
        .iter()
        .filter(|j| j.major >= required_major && j.arch == "x64")
        .min_by_key(|j| {
            let diff = j.major as i32 - required_major as i32;
            // Priorizar: managed > exato > próximo
            (if j.is_managed { 0 } else { 1 }, diff.unsigned_abs())
        });

    if let Some(java) = best {
        println!(
            "[Java] Encontrado Java {} ({}) em {}",
            java.version, java.vendor, java.path
        );
        let exe_path = std::path::PathBuf::from(&java.path)
            .join("bin")
            .join("javaw.exe");
        if exe_path.exists() {
            return Ok(exe_path.to_string_lossy().to_string());
        }
        let exe_path = std::path::PathBuf::from(&java.path)
            .join("bin")
            .join("java.exe");
        return Ok(exe_path.to_string_lossy().to_string());
    }

    // 3. Se auto_java, baixar automaticamente
    println!(
        "[Java] Nenhum Java {} encontrado, baixando automaticamente...",
        required_major
    );
    let installed = install_java(required_major).await?;
    let exe_path = std::path::PathBuf::from(&installed.path)
        .join("bin")
        .join("javaw.exe");
    Ok(exe_path.to_string_lossy().to_string())
}

/// Obter versão Java necessária para uma versão MC (frontend)
#[tauri::command]
pub async fn get_required_java(mc_version: String) -> Result<u32, String> {
    Ok(get_required_java_major(&mc_version))
}
