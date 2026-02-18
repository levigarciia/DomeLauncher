use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    pub r#type: String,
    pub url: String,
    pub time: String,
    pub release_time: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Artifact {
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<serde_json::Value>, // Simplificado para Value por enquanto
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OsRule {
    pub name: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetail {
    pub id: String,
    pub r#type: String,
    pub downloads: Downloads,
    pub main_class: String,
    pub libraries: Vec<Library>,
    pub assets: String,
    pub asset_index: AssetIndex,
    pub compliance_level: Option<u32>,
    pub arguments: Option<serde_json::Value>,
    pub minecraft_arguments: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
    pub total_size: Option<u64>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Downloads {
    pub client: DownloadEntry,
    pub server: Option<DownloadEntry>,
    pub windows_server: Option<DownloadEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(alias = "mc_type")]
    pub mc_type: String,
    #[serde(alias = "loader_type")]
    pub loader_type: Option<String>,
    #[serde(alias = "loader_version")]
    pub loader_version: Option<String>,
    pub icon: Option<String>,
    pub path: PathBuf,
    pub created: String,
    #[serde(alias = "last_played")]
    pub last_played: Option<String>,
    #[serde(alias = "java_args")]
    pub java_args: Option<String>,
    #[serde(alias = "mc_args")]
    pub mc_args: Option<String>,
    pub memory: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum LoaderType {
    Fabric,
    Forge,
    NeoForge,
    Quilt,
    Vanilla,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModPlatform {
    CurseForge,
    Modrinth,
    FTB,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub platform: ModPlatform,
    pub dependencies: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModPack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub minecraft_version: String,
    pub loader_type: LoaderType,
    pub loader_version: String,
    pub download_url: String,
    pub file_name: String,
    pub icon: Option<String>,
    pub image: Option<String>,
    pub screenshots: Vec<String>,
    pub mods: Vec<ModInfo>,
    pub resource_packs: Vec<String>,
    pub shader_packs: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourcePack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub icon: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShaderPack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub icon: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MinecraftAccount {
    pub id: String,
    pub uuid: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
    pub token_type: String,
}

#[derive(Debug)]
pub struct LauncherState {
    pub account: Arc<Mutex<Option<MinecraftAccount>>>,
    pub accounts: Arc<Mutex<Vec<MinecraftAccount>>>,
    pub instances_path: PathBuf,
    pub processos_instancias: Arc<Mutex<HashMap<String, u32>>>,
}

impl LauncherState {
    pub fn new() -> Self {
        // Determinar o caminho correto para dados do launcher
        let data_path = std::env::var("APPDATA")
            .map(|app_data| PathBuf::from(app_data).join("dome"))
            .unwrap_or_else(|_| PathBuf::from("."));

        let instances_path = data_path.join("instances");

        // Criar o diretório se não existir
        if let Err(e) = std::fs::create_dir_all(&instances_path) {
            eprintln!("Warning: Could not create instances directory: {}", e);
        }

        // Carregar contas salvas (multi-conta) e conta ativa.
        let accounts = Self::load_saved_accounts(&data_path);
        let account = Self::load_saved_account(&data_path).or_else(|| accounts.first().cloned());

        Self {
            account: Arc::new(Mutex::new(account)),
            accounts: Arc::new(Mutex::new(accounts)),
            instances_path,
            processos_instancias: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn registrar_processo_instancia(&self, instance_id: &str, pid: u32) {
        if let Ok(mut processos) = self.processos_instancias.lock() {
            processos.insert(instance_id.to_string(), pid);
        }
    }

    pub fn obter_pid_instancia(&self, instance_id: &str) -> Option<u32> {
        self.processos_instancias
            .lock()
            .ok()
            .and_then(|processos| processos.get(instance_id).copied())
    }

    pub fn remover_pid_instancia(&self, instance_id: &str) {
        if let Ok(mut processos) = self.processos_instancias.lock() {
            processos.remove(instance_id);
        }
    }

    /// Caminho para o arquivo de conta
    fn get_account_path() -> PathBuf {
        std::env::var("APPDATA")
            .map(|app_data| PathBuf::from(app_data).join("dome").join("account.json"))
            .unwrap_or_else(|_| PathBuf::from("account.json"))
    }

    /// Caminho para o arquivo de contas salvas (multi-conta)
    fn get_accounts_path() -> PathBuf {
        std::env::var("APPDATA")
            .map(|app_data| PathBuf::from(app_data).join("dome").join("accounts.json"))
            .unwrap_or_else(|_| PathBuf::from("accounts.json"))
    }

    /// Carrega a conta salva do arquivo
    fn load_saved_account(data_path: &PathBuf) -> Option<MinecraftAccount> {
        let account_path = data_path.join("account.json");

        if account_path.exists() {
            match std::fs::read_to_string(&account_path) {
                Ok(content) => {
                    match serde_json::from_str::<MinecraftAccount>(&content) {
                        Ok(account) => {
                            println!(
                                "[Auth] Conta carregada: {} ({})",
                                account.name, account.uuid
                            );

                            // Sempre carregar a conta - a renovação será feita quando necessário
                            // O refresh_token do Microsoft/Xbox é válido por 90 dias
                            return Some(account);
                        }
                        Err(e) => {
                            eprintln!("[Auth] Erro ao deserializar conta: {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[Auth] Erro ao ler arquivo de conta: {}", e);
                }
            }
        }

        None
    }

    /// Carrega todas as contas salvas para seleção rápida.
    fn load_saved_accounts(data_path: &PathBuf) -> Vec<MinecraftAccount> {
        let accounts_path = data_path.join("accounts.json");
        let mut contas: Vec<MinecraftAccount> = Vec::new();

        if accounts_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&accounts_path) {
                if let Ok(mut parsed) = serde_json::from_str::<Vec<MinecraftAccount>>(&content) {
                    // Remover duplicadas por UUID, preservando a primeira ocorrência.
                    let mut uuids = HashSet::new();
                    parsed.retain(|conta| uuids.insert(conta.uuid.clone()));
                    contas = parsed;
                }
            }
        }

        // Fallback para formato antigo (conta única).
        if contas.is_empty() {
            if let Some(conta_unica) = Self::load_saved_account(data_path) {
                contas.push(conta_unica);
            }
        }

        contas
    }

    fn salvar_lista_contas(&self, contas: &[MinecraftAccount]) -> Result<(), String> {
        let accounts_path = Self::get_accounts_path();
        if let Some(parent) = accounts_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Erro ao criar diretório: {}", e))?;
        }

        let content = serde_json::to_string_pretty(contas)
            .map_err(|e| format!("Erro ao serializar lista de contas: {}", e))?;

        std::fs::write(&accounts_path, content)
            .map_err(|e| format!("Erro ao salvar lista de contas: {}", e))?;
        Ok(())
    }

    /// Salva a conta no arquivo
    pub fn save_account(&self, account: &MinecraftAccount) -> Result<(), String> {
        let account_path = Self::get_account_path();

        // Garantir que o diretório existe
        if let Some(parent) = account_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Erro ao criar diretório: {}", e))?;
        }

        let content = serde_json::to_string_pretty(account)
            .map_err(|e| format!("Erro ao serializar conta: {}", e))?;

        std::fs::write(&account_path, content)
            .map_err(|e| format!("Erro ao salvar conta: {}", e))?;

        if let Ok(mut atual) = self.account.lock() {
            *atual = Some(account.clone());
        }

        let contas_atualizadas = {
            let mut contas = self
                .accounts
                .lock()
                .map_err(|_| "Falha ao acessar lista de contas".to_string())?;

            if let Some(indice) = contas.iter().position(|conta| conta.uuid == account.uuid) {
                contas[indice] = account.clone();
            } else {
                contas.push(account.clone());
            }

            contas.clone()
        };

        self.salvar_lista_contas(&contas_atualizadas)?;

        println!("[Auth] Conta salva: {} ({})", account.name, account.uuid);
        Ok(())
    }

    /// Remove a conta salva (logout)
    pub fn clear_account(&self) -> Result<(), String> {
        let account_path = Self::get_account_path();

        if account_path.exists() {
            std::fs::remove_file(&account_path)
                .map_err(|e| format!("Erro ao remover arquivo de conta: {}", e))?;
        }

        // Limpar do estado
        if let Ok(mut acc) = self.account.lock() {
            *acc = None;
        }

        println!("[Auth] Conta removida (logout)");
        Ok(())
    }

    pub fn list_accounts(&self) -> Vec<MinecraftAccount> {
        self.accounts
            .lock()
            .map(|contas| contas.clone())
            .unwrap_or_default()
    }

    pub fn set_active_account(&self, uuid: &str) -> Result<MinecraftAccount, String> {
        let conta = self
            .accounts
            .lock()
            .map_err(|_| "Falha ao acessar lista de contas".to_string())?
            .iter()
            .find(|conta| conta.uuid == uuid)
            .cloned()
            .ok_or("Conta não encontrada.".to_string())?;

        self.save_account(&conta)?;
        Ok(conta)
    }

    pub fn remove_account(&self, uuid: &str) -> Result<(), String> {
        let contas_atualizadas = {
            let mut contas = self
                .accounts
                .lock()
                .map_err(|_| "Falha ao acessar lista de contas".to_string())?;

            let quantidade_inicial = contas.len();
            contas.retain(|conta| conta.uuid != uuid);
            if contas.len() == quantidade_inicial {
                return Err("Conta não encontrada para remoção.".to_string());
            }

            contas.clone()
        };

        self.salvar_lista_contas(&contas_atualizadas)?;

        let ativa_eh_removida = self
            .account
            .lock()
            .map_err(|_| "Falha ao acessar sessão atual".to_string())?
            .as_ref()
            .map(|conta| conta.uuid == uuid)
            .unwrap_or(false);

        if ativa_eh_removida {
            self.clear_account()?;
        }

        Ok(())
    }

    pub fn get_instances(&self) -> Result<Vec<Instance>, String> {
        // Carregar instâncias do diretório
        let mut instances = Vec::new();
        let mut ids_vistos = HashSet::new();

        println!("Procurando instâncias em: {:?}", self.instances_path);

        if let Ok(entries) = std::fs::read_dir(&self.instances_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let config_path = entry.path().join("instance.json");
                    println!("Verificando: {:?}", config_path);
                    if config_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&config_path) {
                            match serde_json::from_str::<Instance>(&content) {
                                Ok(mut instance) => {
                                    // Garantir que o path esteja correto (usar o caminho real do diretório)
                                    let name = instance.name.clone();
                                    let id = instance.id.clone();
                                    if instance.last_played.as_deref() == Some("Nunca") {
                                        instance.last_played = None;
                                    }
                                    if !ids_vistos.insert(id.clone()) {
                                        println!(
                                            "Instância duplicada ignorada (id repetido): {} em {:?}",
                                            id,
                                            entry.path()
                                        );
                                        continue;
                                    }
                                    instance.path = entry.path();
                                    instances.push(instance);
                                    println!("Instância carregada: {} ({})", name, id);
                                }
                                Err(e) => {
                                    println!("Erro ao parsear instance.json: {}", e);
                                }
                            }
                        } else {
                            println!("Erro ao ler instance.json");
                        }
                    } else {
                        println!("instance.json não encontrado em {:?}", entry.path());
                    }
                }
            }
        } else {
            println!(
                "Erro ao ler diretório de instâncias: {:?}",
                self.instances_path
            );
        }

        println!("Total de instâncias encontradas: {}", instances.len());
        Ok(instances)
    }
}

// ===== APIs PARA PLATAFORMAS =====
// Implementações movidas para lib.rs para melhor integração com Tauri
