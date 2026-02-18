mod auth;
mod auth_sisu;
mod discord_social;
mod launcher;
mod skin;

use chrono;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use futures::{stream, StreamExt};
use launcher::{
    Instance, LauncherState, LoaderType, ModInfo, ModPlatform, VersionDetail, VersionManifest,
};
use serde::{Deserialize, Serialize};
use tauri::State;
use urlencoding;

// Constantes das APIs
const CURSEFORGE_API_KEY_FALLBACK: &str = "$2a$10$3tlPo5aXjpTEHidlj1KYK.daU7MRunI/B9lFTYomfO4v6Zpwd/BRK";
const CURSEFORGE_API_BASE: &str = "https://api.curseforge.com/v1";
const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";
const DISCORD_RPC_APP_ID: &str = "1380421346605138041";
const DISCORD_RPC_CLIENT_ID: &str = "1380421346605138041";
const DISCORD_RPC_URL_SITE: &str = "https://domestudios.com.br/domelauncher";
const DISCORD_RPC_URL_DISCORD: &str = "https://discord.domestudios.com.br";
const MINECRAFT_SITEMAP_URL: &str = "https://www.minecraft.net/sitemap.xml";
const MINECRAFT_SITE_BASE_URL: &str = "https://www.minecraft.net";
const CACHE_NOTICIAS_TTL_MS: u64 = 30 * 60 * 1000;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct NoticiaMinecraft {
    pub titulo: String,
    pub descricao: String,
    pub url: String,
    pub imagem_url: Option<String>,
    pub publicado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AmigoLauncherApi {
    pub amizade_id: String,
    pub friend_profile_id: String,
    pub nome: String,
    pub handle: Option<String>,
    pub online: bool,
    pub ultimo_seen_em: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SolicitacaoRecebidaAmizadeApi {
    pub id: String,
    pub de_perfil_id: String,
    pub de_handle: Option<String>,
    pub de_nome: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SolicitacaoEnviadaAmizadeApi {
    pub id: String,
    pub para_perfil_id: String,
    pub para_handle: Option<String>,
    pub para_nome: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct RespostaAmigosLauncherApi {
    #[serde(default)]
    pub amigos: Vec<AmigoLauncherApi>,
    #[serde(default)]
    pub pendentes_recebidas: Vec<SolicitacaoRecebidaAmizadeApi>,
    #[serde(default)]
    pub pendentes_enviadas: Vec<SolicitacaoEnviadaAmizadeApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ContaMinecraftSocialLauncherApi {
    pub uuid: String,
    pub nome: String,
    pub vinculado_em: String,
    pub ultimo_uso_em: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PerfilSocialLauncherApi {
    pub perfil_id: String,
    pub discord_id: String,
    pub discord_username: String,
    pub discord_global_name: Option<String>,
    pub discord_avatar: Option<String>,
    pub handle: String,
    pub nome_social: String,
    #[serde(default)]
    pub contas_minecraft_vinculadas: Vec<ContaMinecraftSocialLauncherApi>,
    pub conta_minecraft_principal_uuid: Option<String>,
    pub online: bool,
    pub ultimo_seen_em: Option<String>,
    pub criado_em: String,
    pub atualizado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PayloadSalvarPerfilSocialLauncherApi {
    pub nome_social: Option<String>,
    pub handle: Option<String>,
    pub conta_minecraft_principal_uuid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RespostaSalvarPerfilSocialLauncherApi {
    pub sucesso: Option<bool>,
    pub perfil: Option<PerfilSocialLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PayloadSolicitarAmizadeHandleLauncherApi {
    pub handle: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MensagemChatLauncherApi {
    pub id: String,
    pub de_perfil_id: String,
    pub para_perfil_id: String,
    pub conteudo: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RespostaMensagensChatLauncherApi {
    pub conversa_id: String,
    #[serde(default)]
    pub mensagens: Vec<MensagemChatLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PayloadEnviarMensagemChatLauncherApi {
    pub para_perfil_id: String,
    pub conteudo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PayloadVincularMinecraftSocialLauncherApi {
    pub uuid: String,
    pub nome: String,
    pub minecraft_access_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheNoticiasMinecraft {
    pub gerado_em_ms: u64,
    pub itens: Vec<NoticiaMinecraft>,
}

fn normalizar_api_base_url(api_base_url: &str) -> Result<String, String> {
    let api_base = api_base_url.trim().trim_end_matches('/').to_string();
    if api_base.is_empty() {
        return Err("URL da API do launcher não configurada.".to_string());
    }
    if !api_base.starts_with("http://") && !api_base.starts_with("https://") {
        return Err("URL da API do launcher inválida.".to_string());
    }
    Ok(api_base)
}

fn criar_cliente_http_launcher() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP do launcher: {}", e))
}

async fn extrair_mensagem_erro_launcher(resposta: reqwest::Response, contexto: &str) -> String {
    let status = resposta.status();
    let corpo = resposta.text().await.unwrap_or_default();
    if corpo.is_empty() {
        return format!("{} (HTTP {})", contexto, status.as_u16());
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&corpo) {
        let mensagem = json
            .get("erro")
            .and_then(|erro| erro.get("mensagem"))
            .and_then(|valor| valor.as_str())
            .or_else(|| json.get("message").and_then(|valor| valor.as_str()))
            .or_else(|| json.get("erro").and_then(|valor| valor.as_str()))
            .or_else(|| json.get("error").and_then(|valor| valor.as_str()));

        if let Some(mensagem) = mensagem {
            return format!("{} (HTTP {}): {}", contexto, status.as_u16(), mensagem);
        }
    }

    let trecho: String = corpo.chars().take(200).collect();
    format!("{} (HTTP {}): {}", contexto, status.as_u16(), trecho)
}

#[tauri::command]
async fn get_launcher_friends(
    api_base_url: String,
    access_token: String,
) -> Result<RespostaAmigosLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/friends", api_base);

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .get(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao buscar amigos: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao buscar amigos.",
        )
        .await);
    }

    resposta
        .json::<RespostaAmigosLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida da API de amigos: {}", e))
}

#[tauri::command]
async fn get_launcher_social_profile(
    api_base_url: String,
    access_token: String,
) -> Result<PerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/social/profile/me", api_base);

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .get(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao buscar perfil social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao carregar perfil social.",
        )
        .await);
    }

    let dados = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida da API de perfil social: {}", e))?;

    serde_json::from_value::<PerfilSocialLauncherApi>(
        dados.get("perfil").cloned().unwrap_or(serde_json::Value::Null),
    )
    .map_err(|e| format!("Resposta sem perfil social válido: {}", e))
}

#[tauri::command]
async fn save_launcher_social_profile(
    api_base_url: String,
    access_token: String,
    payload: PayloadSalvarPerfilSocialLauncherApi,
) -> Result<RespostaSalvarPerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/social/profile/me", api_base);
    let client = criar_cliente_http_launcher()?;

    let resposta = client
        .patch(&endpoint)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao salvar perfil social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao salvar perfil social.",
        )
        .await);
    }

    resposta
        .json::<RespostaSalvarPerfilSocialLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida da API ao salvar perfil social: {}", e))
}

#[tauri::command]
async fn send_launcher_friend_request_by_handle(
    api_base_url: String,
    access_token: String,
    payload: PayloadSolicitarAmizadeHandleLauncherApi,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    if payload.handle.trim().is_empty() {
        return Err("Handle inválido para solicitação de amizade.".to_string());
    }

    let endpoint = format!("{}/api/launcher/friends/request-by-handle", api_base);
    let client = criar_cliente_http_launcher()?;
    let corpo = PayloadSolicitarAmizadeHandleLauncherApi {
        handle: payload.handle.trim().to_string(),
    };

    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .json(&corpo)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao enviar solicitação de amizade: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Não foi possível enviar solicitação de amizade.",
        )
        .await);
    }

    Ok(())
}

#[tauri::command]
async fn get_launcher_chat_messages(
    api_base_url: String,
    access_token: String,
    friend_profile_id: String,
    limite: Option<u32>,
) -> Result<RespostaMensagensChatLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let friend_profile_id = friend_profile_id.trim().to_string();
    if friend_profile_id.is_empty() {
        return Err("friendProfileId inválido para buscar mensagens do chat.".to_string());
    }

    let limite_ajustado = limite.unwrap_or(60).clamp(1, 120);
    let endpoint = format!(
        "{}/api/launcher/chat/{}?limite={}",
        api_base,
        urlencoding::encode(&friend_profile_id),
        limite_ajustado
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .get(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao buscar mensagens do chat: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao carregar conversa do chat.",
        )
        .await);
    }

    resposta
        .json::<RespostaMensagensChatLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida da API de chat: {}", e))
}

#[tauri::command]
async fn send_launcher_chat_message(
    api_base_url: String,
    access_token: String,
    payload: PayloadEnviarMensagemChatLauncherApi,
) -> Result<MensagemChatLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;

    let para_perfil_id = payload.para_perfil_id.trim().to_string();
    if para_perfil_id.is_empty() {
        return Err("Perfil do destinatario inválido para envio da mensagem.".to_string());
    }

    let conteudo = payload.conteudo.trim().to_string();
    if conteudo.is_empty() {
        return Err("Mensagem vazia.".to_string());
    }

    if conteudo.chars().count() > 500 {
        return Err("Mensagem excede 500 caracteres.".to_string());
    }

    let endpoint = format!("{}/api/launcher/chat/send", api_base);
    let client = criar_cliente_http_launcher()?;
    let corpo = PayloadEnviarMensagemChatLauncherApi {
        para_perfil_id,
        conteudo,
    };

    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .json(&corpo)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao enviar mensagem do chat: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao enviar mensagem do chat.",
        )
        .await);
    }

    let dados = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida da API ao enviar mensagem: {}", e))?;

    serde_json::from_value::<MensagemChatLauncherApi>(
        dados.get("mensagem").cloned().unwrap_or(serde_json::Value::Null),
    )
    .map_err(|e| format!("Resposta sem mensagem válida no chat: {}", e))
}

#[tauri::command]
async fn respond_launcher_friend_request(
    api_base_url: String,
    access_token: String,
    request_id: String,
    acao: String,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return Err("ID da solicitacao invalido.".to_string());
    }

    let acao_normalizada = acao.trim().to_lowercase();
    let endpoint = match acao_normalizada.as_str() {
        "accept" | "aceitar" => format!("{}/api/launcher/friends/request/{}/accept", api_base, urlencoding::encode(&request_id)),
        "reject" | "recusar" => format!("{}/api/launcher/friends/request/{}/reject", api_base, urlencoding::encode(&request_id)),
        _ => return Err("Ação inválida. Use accept/reject.".to_string())
    };

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao responder solicitacao: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Nao foi possivel responder solicitacao.",
        )
        .await);
    }

    Ok(())
}

#[tauri::command]
async fn remove_launcher_friend(
    api_base_url: String,
    access_token: String,
    friend_profile_id: String,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let friend_profile_id = friend_profile_id.trim().to_string();
    if friend_profile_id.is_empty() {
        return Err("friendProfileId inválido.".to_string());
    }

    let endpoint = format!(
        "{}/api/launcher/friends/{}",
        api_base,
        urlencoding::encode(&friend_profile_id)
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .delete(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao remover amizade: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Nao foi possivel remover amizade.",
        )
        .await);
    }

    Ok(())
}

#[tauri::command]
async fn link_launcher_minecraft_account(
    api_base_url: String,
    access_token: String,
    payload: PayloadVincularMinecraftSocialLauncherApi,
) -> Result<RespostaSalvarPerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/social/minecraft/link", api_base);

    if payload.minecraft_access_token.trim().is_empty() {
        return Err("minecraftAccessToken obrigatório para vincular conta.".to_string());
    }

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao vincular conta Minecraft: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao vincular conta Minecraft.",
        )
        .await);
    }

    resposta
        .json::<RespostaSalvarPerfilSocialLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida ao vincular conta Minecraft: {}", e))
}

#[tauri::command]
async fn unlink_launcher_minecraft_account(
    api_base_url: String,
    access_token: String,
    uuid: String,
) -> Result<RespostaSalvarPerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let uuid = uuid.trim().to_lowercase();
    if uuid.is_empty() {
        return Err("UUID inválido para desvincular conta.".to_string());
    }

    let endpoint = format!(
        "{}/api/launcher/social/minecraft/{}",
        api_base,
        urlencoding::encode(&uuid)
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .delete(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao desvincular conta Minecraft: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao desvincular conta Minecraft.",
        )
        .await);
    }

    resposta
        .json::<RespostaSalvarPerfilSocialLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida ao desvincular conta Minecraft: {}", e))
}

#[tauri::command]
async fn refresh_launcher_social_session(
    api_base_url: String,
    refresh_token: String,
) -> Result<serde_json::Value, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let refresh_token = refresh_token.trim().to_string();
    if refresh_token.is_empty() {
        return Err("refreshToken ausente.".to_string());
    }

    let endpoint = format!("{}/api/launcher/auth/refresh", api_base);
    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao renovar sessao social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao renovar sessao social.",
        )
        .await);
    }

    resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida ao renovar sessao social: {}", e))
}

#[tauri::command]
async fn logout_launcher_social(
    api_base_url: String,
    access_token: String,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/auth/logout", api_base);

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao encerrar sessao social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao encerrar sessao social.",
        )
        .await);
    }

    Ok(())
}

fn normalizar_token_social(access_token: &str) -> Result<String, String> {
    let token = access_token.trim().to_string();
    if token.is_empty() {
        return Err("Token social ausente.".to_string());
    }

    Ok(token)
}

fn obter_chave_api_curseforge() -> Option<String> {
    let chave_env = std::env::var("CURSEFORGE_API_KEY")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    chave_env.or_else(|| {
        let fallback = CURSEFORGE_API_KEY_FALLBACK.trim();
        if fallback.is_empty() {
            None
        } else {
            Some(fallback.to_string())
        }
    })
}

fn anexar_headers_curseforge(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::RequestBuilder, String> {
    let chave = obter_chave_api_curseforge().ok_or_else(|| {
        "Chave da API CurseForge ausente. Defina CURSEFORGE_API_KEY no ambiente.".to_string()
    })?;

    Ok(request
        .header("x-api-key", chave)
        .header("Accept", "application/json"))
}

fn class_id_por_tipo_conteudo(tipo: &str) -> u32 {
    match tipo {
        "modpack" => 4471,
        "resourcepack" => 12,
        "shader" => 6552,
        _ => 6, // mod
    }
}

fn rota_curseforge_por_tipo_conteudo(tipo: &str) -> &'static str {
    match tipo {
        "modpack" => "modpacks",
        "resourcepack" => "texture-packs",
        "shader" => "shaders",
        _ => "mc-mods",
    }
}

fn extrair_slug_de_url_curseforge(url: &str) -> Option<String> {
    let sem_query = url.split('?').next().unwrap_or(url);
    sem_query
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|slug| !slug.is_empty())
        .map(|slug| slug.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PresencaDiscordPayload {
    pub detalhes: String,
    pub estado: Option<String>,
}

#[derive(Default)]
struct EstadoDiscordPresence {
    pub cliente: std::sync::Mutex<Option<DiscordIpcClient>>,
    pub ultimo_payload: std::sync::Mutex<Option<PresencaDiscordPayload>>,
}

#[tauri::command]
async fn get_minecraft_versions() -> Result<VersionManifest, String> {
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
fn get_instances(state: State<LauncherState>) -> Result<Vec<Instance>, String> {
    state.get_instances().map_err(|e| e.to_string())
}

// ===== FUNÇÃO PARA BUSCAR VERSÕES DOS LOADERS =====

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoaderVersionInfo {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoaderVersionsResponse {
    pub versions: Vec<LoaderVersionInfo>,
}

/// Busca versões disponíveis dos loaders (Fabric, Forge, NeoForge)
#[tauri::command]
async fn get_loader_versions(loader_type: String) -> Result<LoaderVersionsResponse, String> {
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

fn tag_minecraft_compativel(tag: &str, versao_instancia: &str) -> bool {
    if tag == versao_instancia {
        return true;
    }

    // Aceita tags amplas como "1.21" para qualquer patch 1.21.x.
    let tag_numerica = tag
        .chars()
        .all(|c| c.is_ascii_digit() || c == '.');
    if tag_numerica && tag.matches('.').count() == 1 {
        return versao_instancia.starts_with(&format!("{}.", tag));
    }

    false
}

fn versao_minecraft_compativel(tags: &[String], versao_instancia: &str) -> bool {
    if tags.is_empty() {
        return true;
    }

    tags.iter()
        .any(|tag| tag_minecraft_compativel(tag, versao_instancia))
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

fn arquivo_curseforge_compativel(
    arquivo: &serde_json::Value,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> bool {
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
        .cloned()
        .collect();

    versao_minecraft_compativel(&versoes_mc, versao_instancia)
        && loader_compativel(&tags_loader, loader_instancia)
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
async fn install_mod(
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
        let details_response = details_request
            .send()
            .await
            .map_err(|e| format!("Erro na requisição CurseForge: {}", e))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Erro ao parsear resposta CurseForge: {}", e))?;

        // Pegar a versão mais recente compatível
        let mut found_url = None;
        if let Some(latest_files) = details_response["data"]["latestFiles"].as_array() {
            if latest_files.is_empty() {
                return Err("Nenhum arquivo encontrado para este mod no CurseForge".to_string());
            }

            for file in latest_files {
                if !arquivo_curseforge_compativel(file, &versao_instancia, &loader_instancia) {
                    continue;
                }

                if let Some(file_name) = file["fileName"].as_str() {
                    if file_name.ends_with(".jar") {
                        if let Some(url) = file["downloadUrl"].as_str() {
                            found_url = Some(url.to_string());
                            break;
                        }
                    }
                }
            }
        } else {
            return Err("Campo 'latestFiles' não encontrado na resposta do CurseForge".to_string());
        }

        match found_url {
            Some(url) => url,
            None => {
                return Err(format!(
                    "Nenhum arquivo CurseForge compatível com MC {} e loader {:?}",
                    versao_instancia, loader_instancia
                ))
            }
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
async fn install_project_file(
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

    let client = reqwest::Client::new();
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

#[tauri::command]
async fn install_curseforge_project_file(
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

    let payload: serde_json::Value = resposta
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta do CurseForge: {}", e))?;

    let arquivos = payload["data"]
        .as_array()
        .ok_or("Resposta inválida do CurseForge (data ausente)")?;

    let loader_instancia = normalizar_loader_para_mods(instance.loader_type.as_deref());
    let versao_instancia = instance.version.clone();

    let arquivo_escolhido = arquivos
        .iter()
        .find(|arquivo| {
            if !arquivo["isAvailable"].as_bool().unwrap_or(true) {
                return false;
            }

            if tipo_normalizado == "mod" {
                return arquivo_curseforge_compativel(arquivo, &versao_instancia, &loader_instancia);
            }

            let nome = arquivo["fileName"].as_str().unwrap_or("").to_lowercase();
            nome.ends_with(".zip") || nome.ends_with(".jar")
        })
        .ok_or("Nenhum arquivo compatível encontrado no CurseForge")?;

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

#[tauri::command]
fn get_installed_mods(
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
                if file_name.ends_with(".jar") {
                    mods.push(file_name.to_string());
                }
            }
        }
    }

    Ok(mods)
}

#[tauri::command]
fn get_installed_resourcepacks(
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
                if file_name.ends_with(".zip") || entry.path().is_dir() {
                    packs.push(file_name.to_string());
                }
            }
        }
    }

    Ok(packs)
}

#[tauri::command]
fn get_installed_shaders(
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
                if file_name.ends_with(".zip") || entry.path().is_dir() {
                    shaders.push(file_name.to_string());
                }
            }
        }
    }

    Ok(shaders)
}

#[tauri::command]
fn remove_mod(
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
fn remove_project_file(
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

fn obter_instancia_por_id(state: &LauncherState, instance_id: &str) -> Result<Instance, String> {
    state
        .get_instances()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|instancia| instancia.id == instance_id)
        .ok_or_else(|| "Instância não encontrada".to_string())
}

fn validar_caminho_dentro_raiz(
    raiz: &std::path::Path,
    alvo: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let raiz_can = raiz
        .canonicalize()
        .map_err(|e| format!("Falha ao normalizar raiz de segurança: {}", e))?;
    let alvo_can = alvo
        .canonicalize()
        .map_err(|e| format!("Falha ao normalizar caminho alvo: {}", e))?;

    if !alvo_can.starts_with(&raiz_can) {
        return Err("Caminho fora do diretório permitido.".to_string());
    }

    Ok(alvo_can)
}

fn nome_arquivo_valido_log(nome: &str) -> bool {
    nome.ends_with(".log") || nome.ends_with(".txt")
}

// ===== FUNÇÕES DE MONITORAMENTO DO MINECRAFT =====

fn obter_mapa_instancias_em_execucao(
    state: &LauncherState,
    ids_instancia: &[String],
) -> Result<std::collections::HashMap<String, bool>, String> {
    let mut resultados = std::collections::HashMap::new();
    if ids_instancia.is_empty() {
        return Ok(resultados);
    }

    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let mut system =
        System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::new()));
    system.refresh_processes();

    let processos_java = system
        .processes()
        .values()
        .filter_map(|processo| {
            let nome = processo.name().to_lowercase();
            if !nome.contains("java") {
                return None;
            }

            let cmdline = processo
                .cmd()
                .iter()
                .map(|arg| arg.to_string())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
                .replace('\\', "/");

            Some((processo.pid().as_u32(), cmdline))
        })
        .collect::<Vec<_>>();

    for instance_id in ids_instancia {
        let instance_path = state.instances_path.join(instance_id);
        if !instance_path.exists() {
            state.remover_pid_instancia(instance_id);
            resultados.insert(instance_id.clone(), false);
            continue;
        }

        if let Some(pid) = state.obter_pid_instancia(instance_id) {
            let pid_sistema = sysinfo::Pid::from_u32(pid);
            if let Some(processo) = system.process(pid_sistema) {
                if processo.name().to_lowercase().contains("java") {
                    resultados.insert(instance_id.clone(), true);
                    continue;
                }
            } else {
                state.remover_pid_instancia(instance_id);
            }
        }

        let instance_path_normalizado = instance_path
            .to_string_lossy()
            .to_lowercase()
            .replace('\\', "/");

        let processo_localizado = processos_java
            .iter()
            .find(|(_, cmdline)| cmdline.contains(&instance_path_normalizado));

        if let Some((pid, _)) = processo_localizado {
            state.registrar_processo_instancia(instance_id, *pid);
            resultados.insert(instance_id.clone(), true);
            continue;
        }

        resultados.insert(instance_id.clone(), false);
    }

    Ok(resultados)
}

#[tauri::command]
fn is_instance_running(instance_id: String, state: State<LauncherState>) -> Result<bool, String> {
    let mapa = obter_mapa_instancias_em_execucao(&state, std::slice::from_ref(&instance_id))?;
    Ok(*mapa.get(&instance_id).unwrap_or(&false))
}

#[tauri::command]
fn get_running_instances(
    instance_ids: Vec<String>,
    state: State<LauncherState>,
) -> Result<std::collections::HashMap<String, bool>, String> {
    let ids_unicos = instance_ids
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    obter_mapa_instancias_em_execucao(&state, &ids_unicos)
}

#[tauri::command]
fn kill_instance(instance_id: String, state: State<LauncherState>) -> Result<(), String> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let instance_path = state.instances_path.join(&instance_id);
    if !instance_path.exists() {
        state.remover_pid_instancia(&instance_id);
        return Err("Instância não encontrada".to_string());
    }

    let instance_path_normalizado = instance_path
        .to_string_lossy()
        .to_lowercase()
        .replace('\\', "/");

    let mut system =
        System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::new()));
    system.refresh_processes();

    let mut finalizados = 0usize;

    if let Some(pid) = state.obter_pid_instancia(&instance_id) {
        let pid_sistema = sysinfo::Pid::from_u32(pid);
        if let Some(processo) = system.process(pid_sistema) {
            if processo.kill() {
                finalizados += 1;
            }
        }
    }

    if finalizados == 0 {
        for processo in system.processes().values() {
            let nome = processo.name().to_lowercase();
            if !nome.contains("java") {
                continue;
            }

            let cmdline = processo
                .cmd()
                .iter()
                .map(|arg| arg.to_string())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
                .replace('\\', "/");

            if cmdline.contains(&instance_path_normalizado) && processo.kill() {
                finalizados += 1;
            }
        }
    }

    if finalizados == 0 {
        return Err("Nenhum processo do Minecraft foi encontrado para essa instância.".to_string());
    }

    state.remover_pid_instancia(&instance_id);
    Ok(())
}

// ===== FUNÇÕES DE MUNDOS =====

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub name: String,
    pub path: String,
    pub game_mode: String,
    pub difficulty: String,
    pub last_played: String,
    pub size_on_disk: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub name: String,
    pub address: String,
    pub port: u16,
    pub icon: Option<String>,
    pub motd: Option<String>,
    pub player_count: Option<String>,
    pub ping: Option<u32>,
}

fn porta_servidor_padrao() -> u16 {
    25565
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ServidorPersistido {
    pub name: String,
    pub address: String,
    #[serde(default = "porta_servidor_padrao")]
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

fn separar_endereco_porta(endereco: &str) -> (String, u16) {
    let endereco_limpo = endereco.trim();

    if endereco_limpo.is_empty() {
        return (String::new(), porta_servidor_padrao());
    }

    if let Some((host, porta_str)) = endereco_limpo.rsplit_once(':') {
        if host.contains(':') {
            // Endereço IPv6 sem colchetes, manter como está com porta padrão.
            return (endereco_limpo.to_string(), porta_servidor_padrao());
        }

        if let Ok(porta) = porta_str.parse::<u16>() {
            return (host.trim().to_string(), porta);
        }
    }

    (endereco_limpo.to_string(), porta_servidor_padrao())
}

fn caminho_servidores_json_instancia(instancia: &Instance) -> std::path::PathBuf {
    instancia.path.join("servers.json")
}

fn caminho_servidores_dat_instancia(instancia: &Instance) -> std::path::PathBuf {
    instancia.path.join("servers.dat")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServidorDatPersistido {
    #[serde(default)]
    hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(default)]
    ip: String,
    #[serde(default)]
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    accept_textures: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServidoresDatPersistidos {
    #[serde(default)]
    servers: Vec<ServidorDatPersistido>,
}

fn normalizar_servidores_unicos(servidores: Vec<ServidorPersistido>) -> Vec<ServidorPersistido> {
    use std::collections::HashSet;

    let mut vistos = HashSet::new();
    let mut resultado = Vec::new();

    for servidor in servidores {
        if servidor.address.trim().is_empty() {
            continue;
        }

        let chave = format!("{}:{}", servidor.address.to_lowercase(), servidor.port);
        if vistos.insert(chave) {
            resultado.push(servidor);
        }
    }

    resultado
}

fn carregar_servidores_json_instancia(
    instancia: &Instance,
) -> Result<Vec<ServidorPersistido>, String> {
    let caminho = caminho_servidores_json_instancia(instancia);

    if !caminho.exists() {
        return Ok(Vec::new());
    }

    let conteudo = std::fs::read_to_string(&caminho)
        .map_err(|e| format!("Erro ao ler servers.json: {}", e))?;

    serde_json::from_str::<Vec<ServidorPersistido>>(&conteudo)
        .map_err(|e| format!("Erro ao parsear servers.json: {}", e))
}

fn carregar_servidores_dat_instancia(
    instancia: &Instance,
) -> Result<Vec<ServidorPersistido>, String> {
    let caminho = caminho_servidores_dat_instancia(instancia);
    if !caminho.exists() {
        return Ok(Vec::new());
    }

    let dados = std::fs::read(&caminho).map_err(|e| format!("Erro ao ler servers.dat: {}", e))?;

    let parsed = quartz_nbt::serde::deserialize::<ServidoresDatPersistidos>(
        &dados,
        quartz_nbt::io::Flavor::Uncompressed,
    )
    .map_err(|e| format!("Erro ao parsear servers.dat: {}", e))?;

    let servidores = parsed
        .0
        .servers
        .into_iter()
        .filter(|s| !s.hidden && !s.ip.trim().is_empty())
        .map(|s| {
            let (host, porta) = separar_endereco_porta(&s.ip);
            ServidorPersistido {
                name: if s.name.trim().is_empty() {
                    host.clone()
                } else {
                    s.name
                },
                address: host,
                port: porta,
                icon: s.icon,
            }
        })
        .collect();

    Ok(servidores)
}

fn salvar_servidores_json_instancia(
    instancia: &Instance,
    servidores: &[ServidorPersistido],
) -> Result<(), String> {
    let caminho = caminho_servidores_json_instancia(instancia);

    if let Some(parent) = caminho.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Erro ao criar diretório de servidores: {}", e))?;
    }

    let conteudo = serde_json::to_string_pretty(servidores)
        .map_err(|e| format!("Erro ao serializar servers.json: {}", e))?;

    std::fs::write(&caminho, conteudo)
        .map_err(|e| format!("Erro ao salvar servers.json: {}", e))
}

fn salvar_servidores_dat_instancia(
    instancia: &Instance,
    servidores: &[ServidorPersistido],
) -> Result<(), String> {
    let caminho = caminho_servidores_dat_instancia(instancia);

    let servidores_dat = ServidoresDatPersistidos {
        servers: servidores
            .iter()
            .map(|s| ServidorDatPersistido {
                hidden: false,
                ip: if s.port == porta_servidor_padrao() {
                    s.address.clone()
                } else {
                    format!("{}:{}", s.address, s.port)
                },
                name: s.name.clone(),
                icon: s.icon.clone(),
                accept_textures: None,
            })
            .collect(),
    };

    let dados = quartz_nbt::serde::serialize(
        &servidores_dat,
        None,
        quartz_nbt::io::Flavor::Uncompressed,
    )
    .map_err(|e| format!("Erro ao serializar servers.dat: {}", e))?;

    std::fs::write(&caminho, dados).map_err(|e| format!("Erro ao salvar servers.dat: {}", e))
}

fn carregar_servidores_instancia(instancia: &Instance) -> Result<Vec<ServidorPersistido>, String> {
    let mut servidores = Vec::new();

    match carregar_servidores_dat_instancia(instancia) {
        Ok(mut dados) => servidores.append(&mut dados),
        Err(e) => eprintln!("[Servidores] Aviso ao ler servers.dat: {}", e),
    }

    match carregar_servidores_json_instancia(instancia) {
        Ok(mut dados) => servidores.append(&mut dados),
        Err(e) => eprintln!("[Servidores] Aviso ao ler servers.json: {}", e),
    }

    Ok(normalizar_servidores_unicos(servidores))
}

fn salvar_servidores_instancia(
    instancia: &Instance,
    servidores: &[ServidorPersistido],
) -> Result<(), String> {
    let servidores_unicos = normalizar_servidores_unicos(servidores.to_vec());
    salvar_servidores_json_instancia(instancia, &servidores_unicos)?;

    if let Err(e) = salvar_servidores_dat_instancia(instancia, &servidores_unicos) {
        eprintln!("[Servidores] Aviso ao salvar servers.dat: {}", e);
    }

    Ok(())
}

#[tauri::command]
fn get_worlds(instance_id: String, state: State<LauncherState>) -> Result<Vec<WorldInfo>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let saves_dir = instance.path.join("saves");
    let mut worlds = vec![];

    if saves_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(saves_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let level_dat = entry.path().join("level.dat");
                    if level_dat.exists() {
                        let world_name = entry
                            .file_name()
                            .to_str()
                            .unwrap_or("Mundo Desconhecido")
                            .to_string();

                        worlds.push(WorldInfo {
                            name: world_name,
                            path: entry.path().to_str().unwrap_or("").to_string(),
                            game_mode: "Survival".to_string(), // Simulado
                            difficulty: "Normal".to_string(),  // Simulado
                            last_played: "Recentemente".to_string(), // Simulado
                            size_on_disk: "100 MB".to_string(), // Simulado
                        });
                    }
                }
            }
        }
    }

    Ok(worlds)
}

#[tauri::command]
fn get_servers(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<ServerInfo>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let servidores = carregar_servidores_instancia(instance)?;

    Ok(servidores
        .into_iter()
        .map(|s| ServerInfo {
            name: s.name,
            address: s.address,
            port: s.port,
            icon: s.icon,
            motd: None,
            player_count: None,
            ping: None,
        })
        .collect())
}

#[derive(Debug, Deserialize)]
struct RespostaStatusServidorMc {
    description: Option<serde_json::Value>,
    players: Option<JogadoresStatusServidorMc>,
    favicon: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JogadoresStatusServidorMc {
    online: u32,
    max: u32,
}

fn escrever_varint_mc(valor: i32, destino: &mut Vec<u8>) {
    let mut valor = valor as u32;
    loop {
        if (valor & !0x7F) == 0 {
            destino.push(valor as u8);
            return;
        }
        destino.push(((valor & 0x7F) | 0x80) as u8);
        valor >>= 7;
    }
}

fn ler_varint_mc<R: std::io::Read>(reader: &mut R) -> std::io::Result<i32> {
    let mut resultado: i32 = 0;
    let mut posicao = 0;

    loop {
        if posicao >= 35 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "VarInt muito grande",
            ));
        }

        let mut buffer = [0u8; 1];
        reader.read_exact(&mut buffer)?;
        let byte = buffer[0];

        resultado |= ((byte & 0x7F) as i32) << posicao;

        if (byte & 0x80) == 0 {
            return Ok(resultado);
        }

        posicao += 7;
    }
}

fn escrever_string_mc(valor: &str, destino: &mut Vec<u8>) {
    escrever_varint_mc(valor.len() as i32, destino);
    destino.extend_from_slice(valor.as_bytes());
}

fn extrair_texto_descricao_mc(valor: &serde_json::Value) -> Option<String> {
    match valor {
        serde_json::Value::String(texto) => {
            if texto.trim().is_empty() {
                None
            } else {
                Some(texto.to_string())
            }
        }
        serde_json::Value::Object(objeto) => {
            let mut partes: Vec<String> = Vec::new();

            if let Some(texto) = objeto.get("text").and_then(|v| v.as_str()) {
                if !texto.trim().is_empty() {
                    partes.push(texto.to_string());
                }
            }

            if let Some(extra) = objeto.get("extra").and_then(|v| v.as_array()) {
                for item in extra {
                    if let Some(texto) = extrair_texto_descricao_mc(item) {
                        if !texto.trim().is_empty() {
                            partes.push(texto);
                        }
                    }
                }
            }

            if partes.is_empty() {
                None
            } else {
                Some(partes.join(""))
            }
        }
        serde_json::Value::Array(lista) => {
            let partes: Vec<String> = lista
                .iter()
                .filter_map(extrair_texto_descricao_mc)
                .filter(|s| !s.trim().is_empty())
                .collect();

            if partes.is_empty() {
                None
            } else {
                Some(partes.join(""))
            }
        }
        _ => None,
    }
}

fn consultar_status_servidor_minecraft(
    socket_addr: std::net::SocketAddr,
    host_para_handshake: &str,
    porta: u16,
    timeout: std::time::Duration,
) -> Result<(u32, Option<String>, Option<String>, Option<String>), String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let inicio = std::time::Instant::now();
    let mut stream = TcpStream::connect_timeout(&socket_addr, timeout)
        .map_err(|e| format!("Falha ao conectar para status: {}", e))?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("Falha ao configurar timeout de leitura: {}", e))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("Falha ao configurar timeout de escrita: {}", e))?;

    let mut payload_handshake = Vec::new();
    escrever_varint_mc(0x00, &mut payload_handshake); // packet id
    escrever_varint_mc(-1, &mut payload_handshake); // protocol version auto
    escrever_string_mc(host_para_handshake, &mut payload_handshake);
    payload_handshake.extend_from_slice(&porta.to_be_bytes());
    escrever_varint_mc(0x01, &mut payload_handshake); // next state status

    let mut pacote_handshake = Vec::new();
    escrever_varint_mc(payload_handshake.len() as i32, &mut pacote_handshake);
    pacote_handshake.extend_from_slice(&payload_handshake);
    stream
        .write_all(&pacote_handshake)
        .map_err(|e| format!("Falha ao enviar handshake: {}", e))?;

    // Request status (packet length 1, packet id 0)
    stream
        .write_all(&[0x01, 0x00])
        .map_err(|e| format!("Falha ao enviar request de status: {}", e))?;

    let _packet_len = ler_varint_mc(&mut stream)
        .map_err(|e| format!("Falha ao ler tamanho do pacote de status: {}", e))?;
    let packet_id = ler_varint_mc(&mut stream)
        .map_err(|e| format!("Falha ao ler id do pacote de status: {}", e))?;

    if packet_id != 0 {
        return Err(format!(
            "Pacote de status inválido (id esperado 0, recebido {})",
            packet_id
        ));
    }

    let tamanho_json = ler_varint_mc(&mut stream)
        .map_err(|e| format!("Falha ao ler tamanho do JSON de status: {}", e))?;
    if tamanho_json <= 0 || tamanho_json > 2_000_000 {
        return Err("Tamanho de resposta de status inválido".to_string());
    }

    let mut json_bytes = vec![0u8; tamanho_json as usize];
    stream
        .read_exact(&mut json_bytes)
        .map_err(|e| format!("Falha ao ler JSON de status: {}", e))?;

    let json_texto = String::from_utf8(json_bytes)
        .map_err(|e| format!("Resposta de status inválida (UTF-8): {}", e))?;

    let status: RespostaStatusServidorMc = serde_json::from_str(&json_texto)
        .map_err(|e| format!("JSON de status inválido: {}", e))?;

    let ping = inicio.elapsed().as_millis() as u32;
    let motd = status
        .description
        .as_ref()
        .and_then(extrair_texto_descricao_mc);
    let player_count = status
        .players
        .as_ref()
        .map(|p| format!("{}/{}", p.online, p.max));

    Ok((ping, motd, player_count, status.favicon))
}

async fn resolver_srv_minecraft(host: &str) -> Option<(String, u16)> {
    use hickory_resolver::TokioAsyncResolver;

    if host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }

    let resolver = TokioAsyncResolver::tokio_from_system_conf().ok()?;
    let nome_consulta = format!("_minecraft._tcp.{}", host.trim_end_matches('.'));
    let resposta = resolver.srv_lookup(nome_consulta).await.ok()?;

    resposta
        .iter()
        .min_by_key(|registro| registro.priority())
        .map(|registro| {
            (
                registro.target().to_utf8().trim_end_matches('.').to_string(),
                registro.port(),
            )
        })
}

#[tauri::command]
async fn ping_server(address: String) -> Result<ServerInfo, String> {
    use std::net::TcpStream;
    use std::net::ToSocketAddrs;
    use std::time::Duration;

    let (host, porta) = separar_endereco_porta(&address);
    if host.is_empty() {
        return Err("Endereço do servidor inválido".to_string());
    }

    let endereco_tem_porta_explicita = address
        .trim()
        .rsplit_once(':')
        .map(|(h, p)| !h.contains(':') && p.parse::<u16>().is_ok())
        .unwrap_or(false);

    let mut destinos: Vec<(String, u16)> = vec![(host.clone(), porta)];
    if !endereco_tem_porta_explicita {
        if let Some((srv_host, srv_port)) = resolver_srv_minecraft(&host).await {
            if !srv_host.is_empty()
                && !destinos
                    .iter()
                    .any(|(h, p)| h.eq_ignore_ascii_case(&srv_host) && *p == srv_port)
            {
                destinos.insert(0, (srv_host, srv_port));
            }
        }
    }

    let mut ultimo_erro: Option<String> = None;
    let timeout = Duration::from_secs(5);

    for (host_destino, porta_destino) in destinos {
        let destino = format!("{}:{}", host_destino, porta_destino);
        let enderecos = destino
            .to_socket_addrs()
            .map_err(|e| format!("Falha ao resolver endereço do servidor: {}", e))?;

        for socket_addr in enderecos {
            match consultar_status_servidor_minecraft(
                socket_addr,
                &host_destino,
                porta_destino,
                timeout,
            ) {
                Ok((ping, motd, player_count, icon)) => {
                    return Ok(ServerInfo {
                        name: host.clone(),
                        address: host_destino.clone(),
                        port: porta_destino,
                        icon,
                        motd,
                        player_count,
                        ping: Some(ping),
                    });
                }
                Err(status_error) => {
                    // Fallback: conexão TCP simples.
                    let inicio = std::time::Instant::now();
                    match TcpStream::connect_timeout(&socket_addr, timeout) {
                        Ok(_stream) => {
                            let ping = inicio.elapsed().as_millis() as u32;
                            return Ok(ServerInfo {
                                name: host.clone(),
                                address: host_destino.clone(),
                                port: porta_destino,
                                icon: None,
                                motd: None,
                                player_count: None,
                                ping: Some(ping),
                            });
                        }
                        Err(connect_error) => {
                            ultimo_erro = Some(format!(
                                "{} | {}",
                                status_error, connect_error
                            ));
                        }
                    }
                }
            }
        }
    }

    Err(format!(
        "Servidor offline ou inacessível{}",
        ultimo_erro
            .map(|e| format!(": {}", e))
            .unwrap_or_default()
    ))
}

#[tauri::command]
fn add_server(
    instance_id: String,
    name: String,
    address: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let nome_limpo = name.trim();
    if nome_limpo.is_empty() {
        return Err("Nome do servidor não pode ser vazio".to_string());
    }

    let (host, porta) = separar_endereco_porta(&address);
    if host.is_empty() {
        return Err("Endereço do servidor não pode ser vazio".to_string());
    }

    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mut servidores = carregar_servidores_instancia(instance)?;

    if let Some(existente) = servidores
        .iter_mut()
        .find(|s| s.address.eq_ignore_ascii_case(&host) && s.port == porta)
    {
        existente.name = nome_limpo.to_string();
        salvar_servidores_instancia(instance, &servidores)?;
        return Ok(());
    }

    servidores.push(ServidorPersistido {
        name: nome_limpo.to_string(),
        address: host,
        port: porta,
        icon: None,
    });

    salvar_servidores_instancia(instance, &servidores)?;
    Ok(())
}

#[tauri::command]
fn remove_server(
    instance_id: String,
    address: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let (host, porta) = separar_endereco_porta(&address);
    if host.is_empty() {
        return Err("Endereço do servidor inválido".to_string());
    }

    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mut servidores = carregar_servidores_instancia(instance)?;
    let tamanho_antes = servidores.len();
    let remover_apenas_por_host = !address.contains(':');

    servidores.retain(|s| {
        if remover_apenas_por_host {
            !s.address.eq_ignore_ascii_case(&host)
        } else {
            !(s.address.eq_ignore_ascii_case(&host) && s.port == porta)
        }
    });

    if servidores.len() == tamanho_antes {
        return Err("Servidor não encontrado nesta instância".to_string());
    }

    salvar_servidores_instancia(instance, &servidores)?;
    Ok(())
}

#[tauri::command]
fn delete_world(
    instance_id: String,
    world_path: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let saves_dir = instancia.path.join("saves");

    if !saves_dir.exists() {
        return Err("A pasta de saves da instância não existe.".to_string());
    }

    let caminho_bruto = std::path::PathBuf::from(&world_path);
    if !caminho_bruto.exists() {
        return Ok(());
    }

    let caminho_validado = validar_caminho_dentro_raiz(&saves_dir, &caminho_bruto)?;
    if !caminho_validado.is_dir() {
        return Err("O caminho informado não é um mundo válido.".to_string());
    }

    std::fs::remove_dir_all(caminho_validado).map_err(|e| e.to_string())?;
    Ok(())
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
async fn search_mods_online(
    query: String,
    platform: Option<ModPlatform>,
    content_type: Option<String>,
) -> Result<Vec<ModSearchResult>, String> {
    let tipo_conteudo = normalizar_tipo_conteudo(content_type);
    println!(
        "🔍 search_mods_online query='{}' platform={:?} tipo={}",
        query, platform, tipo_conteudo
    );
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

    println!(
        "🎉 Busca concluída: {} resultados encontrados no total",
        results.len()
    );
    Ok(results)
}

async fn search_curseforge_conteudo(
    client: &reqwest::Client,
    query: &str,
    tipo_conteudo: &str,
) -> Result<Vec<ModSearchResult>, String> {
    println!(
        "🔍 Buscando no CurseForge: '{}' ({})",
        query, tipo_conteudo
    );
    let class_id = class_id_por_tipo_conteudo(tipo_conteudo);
    let search_url = format!(
        "{}/mods/search?gameId=432&searchFilter={}&classId={}&pageSize=20&sortField=2&sortOrder=desc",
        CURSEFORGE_API_BASE,
        urlencoding::encode(query),
        class_id
    );

    println!("📡 URL CurseForge: {}", search_url);
    let request = anexar_headers_curseforge(client.get(&search_url))?;
    let response = request
        .send()
        .await
        .map_err(|e| format!("Erro na busca CurseForge: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Erro ao parsear resposta CurseForge: {}", e))?;

    let mut results = Vec::new();

    if let Some(data) = response["data"].as_array() {
        println!("📊 CurseForge retornou {} resultados", data.len());
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
    } else {
        println!("❌ Nenhum dado encontrado na resposta do CurseForge");
    }

    println!("✅ CurseForge: {} resultados processados", results.len());
    Ok(results)
}

async fn search_modrinth_conteudo(
    client: &reqwest::Client,
    query: &str,
    tipo_conteudo: &str,
) -> Result<Vec<ModSearchResult>, String> {
    println!("🔍 Buscando no Modrinth: '{}' ({})", query, tipo_conteudo);
    let search_url = format!(
        "{}/search?query={}&facets=[[\"project_type:{}\"]]&limit=20",
        MODRINTH_API_BASE,
        urlencoding::encode(query),
        tipo_conteudo
    );

    println!("📡 URL Modrinth: {}", search_url);
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
        println!("📊 Modrinth retornou {} mods", hits.len());
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
    } else {
        println!("❌ Nenhum hit encontrado na resposta do Modrinth");
    }

    println!("✅ Modrinth: {} resultados processados", results.len());
    Ok(results)
}

// ===== FUNÇÕES DE LOGS =====

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub filename: String,
    pub path: String,
    pub size: u64,
    pub modified: String,
}

// ===== ESTRUTURAS PARA BUSCA DE MODS =====

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModSearchResult {
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

fn validar_caminho_log_instancia(instance: &Instance, file_path: &str) -> Result<std::path::PathBuf, String> {
    let logs_dir = instance.path.join("logs");
    if !logs_dir.exists() {
        return Err("Diretório de logs da instância não encontrado.".to_string());
    }

    let nome_arquivo = std::path::Path::new(file_path)
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or("Nome de arquivo de log inválido.")?;

    if !nome_arquivo_valido_log(nome_arquivo) {
        return Err("Apenas arquivos .log ou .txt são permitidos.".to_string());
    }

    let caminho_candidato = logs_dir.join(nome_arquivo);
    if !caminho_candidato.exists() {
        return Err("Arquivo de log não encontrado.".to_string());
    }

    validar_caminho_dentro_raiz(&logs_dir, &caminho_candidato)
}

#[tauri::command]
fn get_log_files(instance_id: String, state: State<LauncherState>) -> Result<Vec<LogFile>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let logs_dir = instance.path.join("logs");
    let mut log_files = vec![];

    if logs_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(logs_dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        let filename = entry.file_name().to_str().unwrap_or("").to_string();
                        if filename.ends_with(".log") || filename.ends_with(".txt") {
                            let modified = metadata
                                .modified()
                                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs();

                            log_files.push(LogFile {
                                filename: filename.clone(),
                                path: entry.path().to_str().unwrap_or("").to_string(),
                                size: metadata.len(),
                                modified: format!("{}", modified),
                            });
                        }
                    }
                }
            }
        }
    }

    // Adicionar latest.log se existir
    let latest_log = instance.path.join("logs").join("latest.log");
    if latest_log.exists() {
        if let Ok(metadata) = latest_log.metadata() {
            let modified = metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            log_files.push(LogFile {
                filename: "latest.log".to_string(),
                path: latest_log.to_str().unwrap_or("").to_string(),
                size: metadata.len(),
                modified: format!("{}", modified),
            });
        }
    }

    Ok(log_files)
}

#[tauri::command]
fn get_log_content(
    instance_id: String,
    file_path: String,
    state: State<LauncherState>,
) -> Result<String, String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let caminho_log = validar_caminho_log_instancia(&instance, &file_path)?;
    std::fs::read_to_string(caminho_log).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_log_file(
    instance_id: String,
    file_path: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let caminho_log = validar_caminho_log_instancia(&instance, &file_path)?;
    std::fs::remove_file(caminho_log).map_err(|e| e.to_string())
}

// ===== FUNÇÕES DE INSTALAÇÃO DE LOADERS =====

async fn install_forge_loader(
    instance_path: &std::path::Path,
    minecraft_version: &str,
    forge_version: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}-{}/forge-{}-{}-installer.jar",
        minecraft_version, forge_version, minecraft_version, forge_version
    );

    let temp_dir = std::env::temp_dir().join("dome_launcher_forge_installer");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let installer_path = temp_dir.join("forge-installer.jar");

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
        return Err("Falha ao instalar Forge".to_string());
    }

    // Limpar arquivos temporários
    let _ = std::fs::remove_dir_all(temp_dir);

    Ok(())
}

async fn install_fabric_loader(
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

async fn install_neoforge_loader(
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
async fn create_instance(
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

async fn download_assets_safely(
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

async fn download_instance_files(
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

async fn adjust_forge_manifest(
    details: &mut VersionDetail,
    forge_version: &str,
) -> Result<(), String> {
    // Para Forge, precisamos baixar o manifesto específico do Forge
    let client = reqwest::Client::new();
    let forge_manifest_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}-{}/forge-{}-{}.json",
        details.id, forge_version, details.id, forge_version
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
        // Se não conseguir o manifesto específico, tentar usar o padrão com modificações
        // Adicionar argumentos específicos do Forge
        if let Some(args) = &mut details.arguments {
            if let Some(game_args) = args.get_mut("game") {
                if let Some(arr) = game_args.as_array_mut() {
                    arr.push(serde_json::json!("--fml.forgeVersion"));
                    arr.push(serde_json::json!(forge_version));
                }
            }
        }
    }

    Ok(())
}

async fn adjust_fabric_manifest(
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
                    let new_lib = launcher::Library {
                        name: name.to_string(),
                        rules: None,
                        downloads: Some(launcher::LibraryDownloads {
                            artifact: Some(launcher::Artifact {
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

async fn adjust_neoforge_manifest(
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

fn coletar_argumentos_jvm_manifesto(
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

fn timestamp_atual_segundos() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn atualizar_atividade_cliente_discord(
    cliente: &mut DiscordIpcClient,
    payload: &PresencaDiscordPayload,
) -> Result<(), String> {
    let inicio_sessao = timestamp_atual_segundos() as i64;
    let detalhes = payload.detalhes.trim();
    let detalhes = if detalhes.is_empty() {
        "No launcher"
    } else {
        detalhes
    };

    let atividade_base = activity::Activity::new()
        .timestamps(activity::Timestamps::new().start(inicio_sessao))
        .buttons(vec![
            activity::Button::new("Site", DISCORD_RPC_URL_SITE),
            activity::Button::new("Discord", DISCORD_RPC_URL_DISCORD),
        ]);

    if let Some(estado) = payload.estado.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        cliente
            .set_activity(
                atividade_base
                    .details(detalhes)
                    .state(estado),
            )
            .map_err(|e| format!("Falha ao atualizar atividade Discord RPC: {}", e))?;
    } else {
        cliente
            .set_activity(atividade_base.details(detalhes))
            .map_err(|e| format!("Falha ao atualizar atividade Discord RPC: {}", e))?;
    }

    Ok(())
}

fn desconectar_cliente_discord(cliente: &mut Option<DiscordIpcClient>) {
    if let Some(cliente_ativo) = cliente.as_mut() {
        let _ = cliente_ativo.clear_activity();
        let _ = cliente_ativo.close();
    }
    *cliente = None;
}

fn aplicar_discord_presence(
    estado_presence: &EstadoDiscordPresence,
    settings: &GlobalSettings,
    payload: PresencaDiscordPayload,
) -> Result<(), String> {
    debug_assert_eq!(DISCORD_RPC_APP_ID, DISCORD_RPC_CLIENT_ID);

    let mut cliente = estado_presence
        .cliente
        .lock()
        .map_err(|_| "Falha ao acessar cliente Discord RPC".to_string())?;
    let mut ultimo_payload = estado_presence
        .ultimo_payload
        .lock()
        .map_err(|_| "Falha ao acessar último estado do Discord RPC".to_string())?;

    if !settings.discord_rpc_ativo {
        desconectar_cliente_discord(&mut cliente);
        *ultimo_payload = None;
        return Ok(());
    }

    if ultimo_payload.as_ref() == Some(&payload) {
        return Ok(());
    }

    let reconectar = cliente.is_none();

    if reconectar {
        desconectar_cliente_discord(&mut cliente);
        let mut novo_cliente = DiscordIpcClient::new(DISCORD_RPC_CLIENT_ID)
            .map_err(|e| format!("Falha ao criar cliente Discord RPC: {}", e))?;
        novo_cliente
            .connect()
            .map_err(|e| format!("Falha ao conectar no Discord RPC: {}", e))?;
        *cliente = Some(novo_cliente);
    }

    if let Some(cliente_ativo) = cliente.as_mut() {
        let resultado = atualizar_atividade_cliente_discord(cliente_ativo, &payload);
        if let Err(erro_original) = resultado {
            desconectar_cliente_discord(&mut cliente);

            let mut novo_cliente = DiscordIpcClient::new(DISCORD_RPC_CLIENT_ID)
                .map_err(|e| format!("Falha ao recriar cliente Discord RPC: {}", e))?;
            novo_cliente
                .connect()
                .map_err(|e| format!("Falha ao reconectar no Discord RPC: {}", e))?;
            atualizar_atividade_cliente_discord(&mut novo_cliente, &payload).map_err(|e| {
                format!(
                    "Falha ao atualizar Discord RPC (erro original: {} / nova tentativa: {})",
                    erro_original, e
                )
            })?;
            *cliente = Some(novo_cliente);
        }
    }

    *ultimo_payload = Some(payload);
    Ok(())
}

#[tauri::command]
async fn atualizar_discord_presence(
    estado_presence: State<'_, EstadoDiscordPresence>,
    payload: PresencaDiscordPayload,
) -> Result<(), String> {
    let settings = get_settings().await.unwrap_or_default();
    aplicar_discord_presence(&estado_presence, &settings, payload)
}

#[tauri::command]
fn encerrar_discord_presence(estado_presence: State<'_, EstadoDiscordPresence>) -> Result<(), String> {
    let mut cliente = estado_presence
        .cliente
        .lock()
        .map_err(|_| "Falha ao acessar cliente Discord RPC".to_string())?;
    let mut ultimo_payload = estado_presence
        .ultimo_payload
        .lock()
        .map_err(|_| "Falha ao acessar último estado do Discord RPC".to_string())?;

    desconectar_cliente_discord(&mut cliente);
    *ultimo_payload = None;
    Ok(())
}

async fn obter_conta_valida_para_launch(state: &LauncherState) -> Result<launcher::MinecraftAccount, String> {
    let conta_atual = {
        let lock = state
            .account
            .lock()
            .map_err(|_| "Falha ao acessar sessão atual.".to_string())?;
        lock.clone()
            .ok_or("Você precisa estar logado para jogar.".to_string())?
    };

    let agora = timestamp_atual_segundos();
    let margem_refresh_segundos = 5 * 60;
    let precisa_refresh = conta_atual.refresh_token.is_some()
        && match conta_atual.expires_at {
            Some(expira_em) => agora.saturating_add(margem_refresh_segundos) >= expira_em,
            None => true,
        };

    if precisa_refresh {
        match auth::refresh_token_interno(state).await {
            Ok(conta_renovada) => {
                println!("[Auth] Token renovado automaticamente antes do launch.");
                return Ok(conta_renovada);
            }
            Err(erro) => {
                eprintln!("[Auth] Falha ao renovar token antes do launch: {}", erro);
                let expirado = conta_atual
                    .expires_at
                    .map(|expira_em| agora >= expira_em)
                    .unwrap_or(false);
                let exige_novo_login = erro.to_lowercase().contains("faça login novamente");
                if expirado || exige_novo_login {
                    return Err(
                        "Sua sessão expirou e não foi possível renová-la. Faça login novamente."
                            .to_string(),
                    );
                }
            }
        }
    }

    if conta_atual.refresh_token.is_none()
        && conta_atual
            .expires_at
            .map(|expira_em| agora >= expira_em)
            .unwrap_or(false)
    {
        return Err("Sua sessão expirou. Faça login novamente.".to_string());
    }

    Ok(conta_atual)
}

async fn launch_instance_com_opcoes(
    state: &LauncherState,
    id: String,
    quick_play_servidor: Option<String>,
) -> Result<(), String> {
    let account = obter_conta_valida_para_launch(state).await?;

    let instance_path = state.instances_path.join(&id);

    // 0. Carregar informações da instância
    let instance_config_path = instance_path.join("instance.json");
    if !instance_config_path.exists() {
        return Err("Configuração da instância não encontrada.".to_string());
    }
    let instance_content =
        std::fs::read_to_string(&instance_config_path).map_err(|e| e.to_string())?;
    let mut instance: Instance =
        serde_json::from_str(&instance_content).map_err(|e| e.to_string())?;

    let bin_path = instance_path.join("bin");
    let jar_path = bin_path.join("client.jar");
    let libraries_path = instance_path.join("libraries");
    let assets_path = instance_path.join("assets");
    let natives_path = bin_path.join("natives");

    // 1. Carregar Manifesto
    let version_manifest_path = instance_path.join("version_manifest.json");
    if !version_manifest_path.exists() {
        return Err("Manifesto da versão não encontrado.".to_string());
    }
    let content = std::fs::read_to_string(version_manifest_path).map_err(|e| e.to_string())?;
    let mut details: VersionDetail = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 1.1. Ajustar manifesto baseado no loader
    if let Some(loader_type_str) = &instance.loader_type {
        match loader_type_str.as_str() {
            "Forge" => {
                // Para Forge, precisamos usar o manifesto do Forge
                adjust_forge_manifest(
                    &mut details,
                    instance
                        .loader_version
                        .as_ref()
                        .unwrap_or(&"latest".to_string()),
                )
                .await?;
            }
            "Fabric" => {
                // Para Fabric, ajustar argumentos e classpath
                adjust_fabric_manifest(
                    &mut details,
                    instance
                        .loader_version
                        .as_ref()
                        .unwrap_or(&"latest".to_string()),
                    &instance_path,
                )
                .await?;
            }
            "NeoForge" => {
                // Para NeoForge, similar ao Forge
                adjust_neoforge_manifest(
                    &mut details,
                    instance
                        .loader_version
                        .as_ref()
                        .unwrap_or(&"latest".to_string()),
                )
                .await?;
            }
            _ => {} // Vanilla não precisa ajustes
        }
    }

    // 1.2. Verificar se os arquivos existem (devem ter sido baixados na criação)
    let bin_path = instance_path.join("bin");
    if !bin_path.join("client.jar").exists() {
        return Err("Arquivos do jogo não encontrados. Recrie a instância.".to_string());
    }

    // Verificar se assets existem, se não, baixar
    let assets_dir = instance_path.join("assets");
    let indexes_dir = assets_dir.join("indexes");
    if !indexes_dir.exists()
        || indexes_dir
            .read_dir()
            .map(|mut d| d.next().is_none())
            .unwrap_or(true)
    {
        println!("Assets não encontrados, baixando...");
        download_assets_safely(&instance_path, &details).await?;
    }

    // 2. Extrair Natives e Montar Classpath
    std::fs::create_dir_all(&natives_path).map_err(|e| e.to_string())?;
    let mut cp = Vec::new();

    // Adicionar libs ao CP e extrair natives
    for lib in &details.libraries {
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
                if let Some(artifact) = &downloads.artifact {
                    if let Some(path) = &artifact.path {
                        let full_path = libraries_path.join(path);
                        if full_path.exists() {
                            cp.push(full_path.to_string_lossy().to_string());
                        }
                    }
                }

                if let Some(classifiers) = &downloads.classifiers {
                    let native_key = "natives-windows";
                    if let Some(native_obj) = classifiers.get(native_key) {
                        if let Some(path) = native_obj["path"].as_str() {
                            let native_jar_path = libraries_path.join(path);
                            if native_jar_path.exists() {
                                if let Ok(file) = std::fs::File::open(&native_jar_path) {
                                    if let Ok(mut archive) = zip::ZipArchive::new(file) {
                                        for i in 0..archive.len() {
                                            if let Ok(mut file) = archive.by_index(i) {
                                                let name = file.name().to_string();
                                                if name.ends_with(".dll") {
                                                    let out_path = natives_path.join(
                                                        std::path::Path::new(&name)
                                                            .file_name()
                                                            .unwrap(),
                                                    );
                                                    if let Ok(mut out_file) =
                                                        std::fs::File::create(&out_path)
                                                    {
                                                        std::io::copy(&mut file, &mut out_file)
                                                            .ok();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    cp.push(jar_path.to_string_lossy().to_string());
    let cp_val = cp.join(";");

    // 3. Detectar Java correto automaticamente
    let java_exe = ensure_java_for_version(details.id.clone())
        .await
        .unwrap_or_else(|_| "java".to_string());

    // 4. Carregar configurações globais
    let settings = get_settings().await.unwrap_or_default();

    // 5. Montar Argumentos (respeitar config da instância ou global)
    let mut args = Vec::new();

    // RAM: priorizar instância > global
    let ram_mb = instance.memory.unwrap_or(settings.ram_mb);
    args.push(format!("-Xmx{}M", ram_mb));
    args.push(format!("-Xms{}M", (ram_mb / 2).max(512)));

    // JVM args das configurações
    if let Some(ref custom_args) = instance.java_args {
        for arg in custom_args.split_whitespace() {
            args.push(arg.to_string());
        }
    } else if !settings.java_args.is_empty() {
        for arg in settings.java_args.split_whitespace() {
            args.push(arg.to_string());
        }
    }

    // JVM args vindos do manifesto (Fabric/Forge/etc), com placeholders resolvidos.
    for arg in coletar_argumentos_jvm_manifesto(&details, &natives_path, &libraries_path, &cp_val) {
        args.push(arg);
    }

    args.push(format!(
        "-Djava.library.path={}",
        natives_path.to_string_lossy()
    ));
    args.push("-cp".to_string());
    args.push(cp_val);
    args.push(details.main_class.clone());

    let game_args_raw = if let Some(modern_args) = &details.arguments {
        if let Some(game) = modern_args.get("game") {
            let mut collected = Vec::new();
            if let Some(arr) = game.as_array() {
                for val in arr {
                    if let Some(s) = val.as_str() {
                        collected.push(s.to_string());
                    }
                }
            }
            collected
        } else {
            Vec::new()
        }
    } else if let Some(legacy) = &details.minecraft_arguments {
        legacy.split_whitespace().map(|s| s.to_string()).collect()
    } else {
        Vec::new()
    };

    // Resolução da janela
    let width = instance.width.unwrap_or(settings.width);
    let height = instance.height.unwrap_or(settings.height);

    for arg in game_args_raw {
        let replaced = arg
            .replace("${auth_player_name}", &account.name)
            .replace("${version_name}", &details.id)
            .replace("${game_directory}", &instance_path.to_string_lossy())
            .replace("${assets_root}", &assets_path.to_string_lossy())
            .replace("${assets_index_name}", &details.asset_index.id)
            .replace("${auth_uuid}", &account.uuid)
            .replace("${auth_access_token}", &account.access_token)
            .replace("${clientid}", "")
            .replace("${client_id}", "")
            .replace("${auth_xuid}", "")
            .replace("${user_properties}", "{}")
            .replace("${user_type}", "msa")
            .replace("${version_type}", "release")
            .replace("${resolution_width}", &width.to_string())
            .replace("${resolution_height}", &height.to_string());

        args.push(replaced);
    }

    if let Some(endereco_servidor) = quick_play_servidor {
        let endereco_servidor = endereco_servidor.trim();
        if !endereco_servidor.is_empty()
            && !args
                .iter()
                .any(|a| a.eq_ignore_ascii_case("--quickPlayMultiplayer"))
        {
            args.push("--quickPlayMultiplayer".to_string());
            args.push(endereco_servidor.to_string());
        }
    }

    println!("[Launch] Executando: {} {:?}", java_exe, args);

    // Atualizar último acesso da instância antes de iniciar.
    instance.last_played = Some(chrono::Utc::now().to_rfc3339());
    if let Ok(instance_json) = serde_json::to_string_pretty(&instance) {
        if let Err(e) = std::fs::write(&instance_config_path, instance_json) {
            eprintln!(
                "[Launch] Aviso: falha ao salvar last_played em {:?}: {}",
                instance_config_path, e
            );
        }
    }

    let mut comando_java = std::process::Command::new(&java_exe);
    comando_java.args(&args).current_dir(&instance_path);
    let mut pid_iniciado: Option<u32> = None;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // Garante que o Minecraft permaneça aberto mesmo após fechar o launcher.
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        comando_java.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);

        let resultado_spawn = match comando_java.spawn() {
            Ok(child) => {
                pid_iniciado = Some(child.id());
                Ok(())
            }
            Err(erro) if erro.raw_os_error() == Some(5) => {
                eprintln!(
                    "[Launch] Aviso: criação destacada bloqueada (acesso negado). Tentando fallback padrão."
                );

                let mut comando_fallback = std::process::Command::new(&java_exe);
                comando_fallback.args(&args).current_dir(&instance_path);
                let child = comando_fallback.spawn().map_err(|e| {
                    format!(
                        "Falha ao iniciar Java ({}): {}. Verifique suas configurações de Java.",
                        java_exe, e
                    )
                })?;
                pid_iniciado = Some(child.id());
                Ok(())
            }
            Err(erro) => {
                Err(format!(
                    "Falha ao iniciar Java ({}): {}. Verifique suas configurações de Java.",
                    java_exe, erro
                ))
            }
        };

        resultado_spawn?;
    }

    #[cfg(not(windows))]
    {
        let child = comando_java.spawn().map_err(|e| {
            format!(
                "Falha ao iniciar Java ({}): {}. Verifique suas configurações de Java.",
                java_exe, e
            )
        })?;
        pid_iniciado = Some(child.id());
    }

    if let Some(pid) = pid_iniciado {
        state.registrar_processo_instancia(&id, pid);
    }

    Ok(())
}

#[tauri::command]
async fn launch_instance(state: State<'_, LauncherState>, id: String) -> Result<(), String> {
    launch_instance_com_opcoes(&state, id, None).await
}

#[tauri::command]
async fn launch_instance_to_server(
    state: State<'_, LauncherState>,
    id: String,
    address: String,
) -> Result<(), String> {
    launch_instance_com_opcoes(&state, id, Some(address)).await
}

#[tauri::command]
async fn delete_instance(state: State<'_, LauncherState>, id: String) -> Result<(), String> {
    let instance_path = state.instances_path.join(&id);
    if instance_path.exists() {
        std::fs::remove_dir_all(instance_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_browser(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

// ===== COMANDOS PARA GERENCIAMENTO DE MODS =====

// Funções antigas removidas - funcionalidades implementadas diretamente no código

// ===== COMANDOS PARA GERENCIAMENTO DE INSTÂNCIAS =====

#[tauri::command]
async fn get_instance_details(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<Instance, String> {
    let instance_path = state.instances_path.join(&instance_id);
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

    let instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

    Ok(instance)
}

#[tauri::command]
async fn update_instance_name(
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
async fn update_instance_settings(
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

fn normalizar_nome_pasta_instancia(nome: &str) -> String {
    urlencoding::encode(&nome.trim().to_lowercase().replace(' ', "_")).to_string()
}

#[tauri::command]
async fn rename_instance_folder(
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

// Estrutura para informações do modpack
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModpackInfo {
    project_id: String,
    version_id: String,
    name: String,
    author: String,
    icon: Option<String>,
    slug: String,
    source: String,
    installed_version: String,
}

#[tauri::command]
async fn save_modpack_info(
    state: State<'_, LauncherState>,
    instance_id: String,
    modpack_info: ModpackInfo,
) -> Result<(), String> {
    let instance_path = state.instances_path.join(&instance_id);
    let modpack_path = instance_path.join("modpack.json");

    // Criar diretório se não existir
    if !instance_path.exists() {
        std::fs::create_dir_all(&instance_path)
            .map_err(|e| format!("Erro ao criar diretório: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&modpack_info)
        .map_err(|e| format!("Erro ao serializar modpack.json: {}", e))?;

    std::fs::write(&modpack_path, content)
        .map_err(|e| format!("Erro ao salvar modpack.json: {}", e))?;

    println!("[save_modpack_info] Salvo: {:?}", modpack_path);
    Ok(())
}

#[tauri::command]
async fn install_modpack_files(
    state: State<'_, LauncherState>,
    instance_id: String,
    download_url: String,
    file_name: String,
) -> Result<(), String> {
    let instance_path = state.instances_path.join(&instance_id);
    let mods_path = instance_path.join("mods");
    let temp_path = instance_path.join("temp");

    // Criar diretórios
    std::fs::create_dir_all(&mods_path).map_err(|e| format!("Erro ao criar pasta mods: {}", e))?;
    std::fs::create_dir_all(&temp_path).map_err(|e| format!("Erro ao criar pasta temp: {}", e))?;

    let mrpack_path = temp_path.join(&file_name);

    println!("[install_modpack_files] Baixando: {}", download_url);

    // Baixar o arquivo .mrpack
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar modpack: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes: {}", e))?;

    std::fs::write(&mrpack_path, &bytes).map_err(|e| format!("Erro ao salvar arquivo: {}", e))?;

    println!("[install_modpack_files] Arquivo salvo: {:?}", mrpack_path);

    // Extrair .mrpack (é um ZIP)
    let file =
        std::fs::File::open(&mrpack_path).map_err(|e| format!("Erro ao abrir mrpack: {}", e))?;

    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Erro ao ler ZIP: {}", e))?;

    // Procurar modrinth.index.json para pegar lista de mods
    let mut mods_to_download: Vec<(String, String, String)> = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Erro ao ler arquivo do ZIP: {}", e))?;

        let _outpath = match file.enclosed_name() {
            Some(path) => temp_path.join(path),
            None => continue,
        };

        if file.name() == "modrinth.index.json" {
            // Ler o índice
            let mut contents = String::new();
            std::io::Read::read_to_string(&mut file, &mut contents)
                .map_err(|e| format!("Erro ao ler index: {}", e))?;

            // Parsear JSON
            if let Ok(index) = serde_json::from_str::<serde_json::Value>(&contents) {
                if let Some(files) = index["files"].as_array() {
                    for f in files {
                        if let (Some(path), Some(downloads)) =
                            (f["path"].as_str(), f["downloads"].as_array())
                        {
                            if let Some(url) = downloads.first().and_then(|d| d.as_str()) {
                                let filename = path.split('/').last().unwrap_or("mod.jar");
                                mods_to_download.push((
                                    url.to_string(),
                                    filename.to_string(),
                                    path.to_string(),
                                ));
                            }
                        }
                    }
                }
            }
        } else if file.name().starts_with("overrides/") {
            // Extrair overrides para a pasta da instância
            let relative = file
                .name()
                .strip_prefix("overrides/")
                .unwrap_or(file.name());
            let dest = instance_path.join(relative);

            if file.is_dir() {
                std::fs::create_dir_all(&dest).ok();
            } else {
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                let mut outfile = std::fs::File::create(&dest)
                    .map_err(|e| format!("Erro ao criar arquivo: {}", e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Erro ao copiar arquivo: {}", e))?;
            }
        }
    }

    println!(
        "[install_modpack_files] {} mods para baixar",
        mods_to_download.len()
    );

    // Baixar mods em paralelo
    use futures::stream::{self, StreamExt};

    let download_tasks: Vec<_> = mods_to_download
        .iter()
        .map(|(url, filename, path)| {
            let client = client.clone();
            let url = url.clone();
            let filename = filename.clone();
            let path = path.clone();
            let instance_path = instance_path.clone();

            async move {
                // Determinar pasta de destino (mods, resourcepacks, etc)
                let dest_folder = if path.starts_with("mods/") {
                    instance_path.join("mods")
                } else if path.starts_with("resourcepacks/") {
                    instance_path.join("resourcepacks")
                } else if path.starts_with("shaderpacks/") {
                    instance_path.join("shaderpacks")
                } else if path.starts_with("config/") {
                    instance_path.join("config")
                } else {
                    instance_path.join("mods")
                };

                std::fs::create_dir_all(&dest_folder).ok();
                let dest_path = dest_folder.join(&filename);

                match client.get(&url).send().await {
                    Ok(response) => {
                        if let Ok(bytes) = response.bytes().await {
                            if let Err(e) = std::fs::write(&dest_path, &bytes) {
                                println!(
                                    "[install_modpack_files] Erro ao salvar {}: {}",
                                    filename, e
                                );
                            } else {
                                println!("[install_modpack_files] Baixado: {}", filename);
                            }
                        }
                    }
                    Err(e) => {
                        println!("[install_modpack_files] Erro ao baixar {}: {}", filename, e);
                    }
                }
            }
        })
        .collect();

    // Executar downloads em paralelo (10 simultâneos)
    stream::iter(download_tasks)
        .buffer_unordered(10)
        .collect::<Vec<_>>()
        .await;

    // Limpar arquivos temporários
    std::fs::remove_dir_all(&temp_path).ok();

    println!("[install_modpack_files] Instalação concluída!");
    Ok(())
}

#[tauri::command]
async fn get_modpack_info(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<Option<ModpackInfo>, String> {
    let modpack_path = state.instances_path.join(&instance_id).join("modpack.json");

    if !modpack_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&modpack_path)
        .map_err(|e| format!("Erro ao ler modpack.json: {}", e))?;

    let info: ModpackInfo = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear modpack.json: {}", e))?;

    Ok(Some(info))
}

#[tauri::command]
async fn check_modpack_updates(
    _instance_id: String,
    project_id: String,
    installed_version: String,
) -> Result<Option<String>, String> {
    let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erro ao verificar atualizações: {}", e))?;

    let versions: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta: {}", e))?;

    if let Some(latest) = versions.first() {
        if let Some(version_number) = latest["version_number"].as_str() {
            if version_number != installed_version {
                return Ok(Some(version_number.to_string()));
            }
        }
    }

    Ok(None)
}

fn agora_em_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_millis() as u64)
        .unwrap_or(0)
}

fn get_cache_dir() -> std::path::PathBuf {
    std::env::var("APPDATA")
        .map(|app_data| std::path::PathBuf::from(app_data).join("dome").join("cache"))
        .unwrap_or_else(|_| std::path::PathBuf::from("cache"))
}

fn get_minecraft_news_cache_path() -> std::path::PathBuf {
    get_cache_dir().join("minecraft-news-v2.json")
}

fn ler_cache_noticias_minecraft(limite: usize) -> Option<Vec<NoticiaMinecraft>> {
    let caminho = get_minecraft_news_cache_path();
    let conteudo = std::fs::read_to_string(caminho).ok()?;
    let cache = serde_json::from_str::<CacheNoticiasMinecraft>(&conteudo).ok()?;
    let idade = agora_em_ms().saturating_sub(cache.gerado_em_ms);

    if idade > CACHE_NOTICIAS_TTL_MS {
        return None;
    }

    if cache.itens.is_empty() {
        return None;
    }

    Some(cache.itens.into_iter().take(limite).collect())
}

fn salvar_cache_noticias_minecraft(itens: &[NoticiaMinecraft]) {
    if itens.is_empty() {
        return;
    }

    let caminho = get_minecraft_news_cache_path();
    if let Some(pasta) = caminho.parent() {
        let _ = std::fs::create_dir_all(pasta);
    }

    let cache = CacheNoticiasMinecraft {
        gerado_em_ms: agora_em_ms(),
        itens: itens.to_vec(),
    };

    if let Ok(conteudo) = serde_json::to_string(&cache) {
        let _ = std::fs::write(caminho, conteudo);
    }
}

fn decodificar_entidades(texto: &str) -> String {
    texto
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn limpar_texto_html(texto: &str) -> String {
    decodificar_entidades(texto)
        .replace('\n', " ")
        .replace('\r', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extrair_tag_xml(bloco: &str, tag: &str) -> Option<String> {
    let inicio_tag = format!("<{}>", tag);
    let fim_tag = format!("</{}>", tag);

    let inicio = bloco.find(&inicio_tag)? + inicio_tag.len();
    let resto = &bloco[inicio..];
    let fim_rel = resto.find(&fim_tag)?;
    let valor = resto[..fim_rel].trim();

    if valor.is_empty() {
        None
    } else {
        Some(decodificar_entidades(valor))
    }
}

fn extrair_atributo_html(tag: &str, nome: &str) -> Option<String> {
    let padrao_aspas_duplas = format!(r#"{}=""#, nome);
    if let Some(inicio_idx) = tag.find(&padrao_aspas_duplas) {
        let inicio_valor = inicio_idx + padrao_aspas_duplas.len();
        let restante = &tag[inicio_valor..];
        let fim = restante.find('"')?;
        let valor = restante[..fim].trim();
        if !valor.is_empty() {
            return Some(decodificar_entidades(valor));
        }
    }

    let padrao_aspas_simples = format!("{}='", nome);
    if let Some(inicio_idx) = tag.find(&padrao_aspas_simples) {
        let inicio_valor = inicio_idx + padrao_aspas_simples.len();
        let restante = &tag[inicio_valor..];
        let fim = restante.find('\'')?;
        let valor = restante[..fim].trim();
        if !valor.is_empty() {
            return Some(decodificar_entidades(valor));
        }
    }

    None
}

fn extrair_meta_content(html: &str, atributo: &str, valor: &str) -> Option<String> {
    let marcador_aspas_duplas = format!(r#"{}="{}""#, atributo, valor);
    let marcador_aspas_simples = format!("{}='{}'", atributo, valor);

    for trecho in html.split("<meta").skip(1) {
        let tag = match trecho.split('>').next() {
            Some(valor_tag) => valor_tag,
            None => continue,
        };

        if !tag.contains(&marcador_aspas_duplas) && !tag.contains(&marcador_aspas_simples) {
            continue;
        }

        if let Some(conteudo) = extrair_atributo_html(tag, "content") {
            let limpo = limpar_texto_html(&conteudo);
            if !limpo.is_empty() {
                return Some(limpo);
            }
        }
    }

    None
}

fn extrair_primeiro_meta(html: &str, seletores: &[(&str, &str)]) -> Option<String> {
    for (atributo, valor) in seletores {
        if let Some(conteudo) = extrair_meta_content(html, atributo, valor) {
            if !conteudo.trim().is_empty() {
                return Some(conteudo);
            }
        }
    }
    None
}

fn extrair_titulo_html(html: &str) -> Option<String> {
    let inicio = html.find("<title>")? + "<title>".len();
    let restante = &html[inicio..];
    let fim = restante.find("</title>")?;
    let titulo_bruto = restante[..fim].trim();
    if titulo_bruto.is_empty() {
        return None;
    }

    let titulo_limpo = limpar_texto_html(titulo_bruto)
        .replace(" | Minecraft", "")
        .trim()
        .to_string();
    if titulo_limpo.is_empty() {
        None
    } else {
        Some(titulo_limpo)
    }
}

fn titulo_da_url_artigo(url: &str) -> String {
    let slug = url
        .split("/article/")
        .nth(1)
        .unwrap_or(url)
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_matches('/');

    if slug.is_empty() {
        return "Notícia do Minecraft".to_string();
    }

    slug.split('-')
        .filter(|parte| !parte.trim().is_empty())
        .map(|parte| {
            let mut caracteres = parte.chars();
            match caracteres.next() {
                Some(inicial) => {
                    format!("{}{}", inicial.to_uppercase(), caracteres.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalizar_url_minecraft(url: &str) -> String {
    let valor = url.trim();
    if valor.starts_with("https://") || valor.starts_with("http://") {
        return valor.to_string();
    }
    if valor.starts_with("//") {
        return format!("https:{}", valor);
    }
    if valor.starts_with('/') {
        return format!("{}{}", MINECRAFT_SITE_BASE_URL, valor);
    }
    format!("{}/{}", MINECRAFT_SITE_BASE_URL, valor)
}

async fn montar_noticia_minecraft(
    client: &reqwest::Client,
    url: String,
    publicado_em_sitemap: String,
) -> NoticiaMinecraft {
    let mut titulo = titulo_da_url_artigo(&url);
    let mut descricao = String::new();
    let mut imagem_url: Option<String> = None;
    let mut publicado_em = publicado_em_sitemap;

    if let Ok(resposta) = client
        .get(&url)
        .header("User-Agent", "DomeLauncher/1.0 (+https://domestudios.com.br)")
        .header("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        if resposta.status().is_success() {
            if let Ok(html) = resposta.text().await {
                if let Some(titulo_og) = extrair_primeiro_meta(
                    &html,
                    &[("property", "og:title"), ("name", "twitter:title")],
                ) {
                    titulo = titulo_og;
                } else if let Some(titulo_tag) = extrair_titulo_html(&html) {
                    titulo = titulo_tag;
                }

                if let Some(descricao_og) = extrair_primeiro_meta(
                    &html,
                    &[
                        ("property", "og:description"),
                        ("name", "description"),
                        ("name", "twitter:description"),
                    ],
                ) {
                    descricao = descricao_og;
                }

                if let Some(imagem) = extrair_primeiro_meta(
                    &html,
                    &[("property", "og:image"), ("name", "twitter:image")],
                ) {
                    let url_imagem = normalizar_url_minecraft(&imagem);
                    imagem_url = Some(url_imagem);
                }

                if let Some(data_publicada) = extrair_primeiro_meta(
                    &html,
                    &[("property", "article:published_time"), ("name", "date")],
                ) {
                    publicado_em = data_publicada;
                }
            }
        }
    }

    NoticiaMinecraft {
        titulo,
        descricao,
        url,
        imagem_url,
        publicado_em,
    }
}

async fn baixar_sitemap_minecraft(client: &reqwest::Client) -> Result<String, String> {
    let urls = [
        MINECRAFT_SITEMAP_URL,
        "https://www.minecraft.net/en-us/sitemap.xml",
    ];
    let mut erros: Vec<String> = Vec::new();

    for url in urls {
        match client.get(url).send().await {
            Ok(resposta) => {
                if !resposta.status().is_success() {
                    erros.push(format!("{} retornou HTTP {}", url, resposta.status().as_u16()));
                    continue;
                }

                match resposta.text().await {
                    Ok(conteudo) => return Ok(conteudo),
                    Err(erro) => {
                        erros.push(format!("{} falhou ao ler body: {}", url, erro));
                        continue;
                    }
                }
            }
            Err(erro) => {
                erros.push(format!("{} falhou: {}", url, erro));
                continue;
            }
        }
    }

    Err(format!(
        "Erro ao buscar sitemap do Minecraft: {}",
        erros.join(" | ")
    ))
}

#[tauri::command]
async fn get_minecraft_news(limit: Option<u32>) -> Result<Vec<NoticiaMinecraft>, String> {
    let limite = limit.unwrap_or(5).clamp(1, 10) as usize;

    if let Some(cache) = ler_cache_noticias_minecraft(limite) {
        return Ok(cache);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;

    let sitemap = baixar_sitemap_minecraft(&client).await?;

    let mut artigos: Vec<(String, String)> = Vec::new();

    for trecho in sitemap.split("<url>").skip(1) {
        let bloco = match trecho.split("</url>").next() {
            Some(valor_bloco) => valor_bloco,
            None => continue,
        };

        let loc = match extrair_tag_xml(bloco, "loc") {
            Some(valor) => valor,
            None => continue,
        };

        if !loc.contains("/article/") {
            continue;
        }

        let lastmod = extrair_tag_xml(bloco, "lastmod").unwrap_or_default();
        if lastmod.is_empty() {
            continue;
        }

        artigos.push((loc, lastmod));
    }

    if artigos.is_empty() {
        return Err("Nenhuma notícia encontrada no sitemap do Minecraft.".to_string());
    }

    artigos.sort_by(|a, b| b.1.cmp(&a.1));
    let candidatos: Vec<(String, String)> = artigos.into_iter().take(limite * 3).collect();

    let mut noticias: Vec<NoticiaMinecraft> = stream::iter(candidatos.into_iter())
        .map(|(url, data)| {
            let client = client.clone();
            async move { montar_noticia_minecraft(&client, url, data).await }
        })
        .buffer_unordered(6)
        .collect()
        .await;

    noticias.sort_by(|a, b| b.publicado_em.cmp(&a.publicado_em));
    noticias.truncate(limite);

    if noticias.is_empty() {
        return Err("Nenhuma notícia pôde ser carregada no momento.".to_string());
    }

    salvar_cache_noticias_minecraft(&noticias);

    Ok(noticias)
}

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
async fn get_settings() -> Result<GlobalSettings, String> {
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
async fn save_settings(settings: GlobalSettings) -> Result<(), String> {
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
async fn get_system_ram() -> Result<u32, String> {
    let sys = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::new().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    Ok((sys.total_memory() / 1024 / 1024) as u32)
}

/// Detecta todas as instalações de Java no sistema (estilo HeliosLauncher)
#[tauri::command]
async fn detect_java_installations() -> Result<Vec<JavaInfo>, String> {
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
async fn probe_java(exe_path: &std::path::Path, is_managed: bool) -> Option<JavaInfo> {
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
async fn install_java(major: u32) -> Result<JavaInfo, String> {
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
async fn ensure_java_for_version(mc_version: String) -> Result<String, String> {
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
async fn get_required_java(mc_version: String) -> Result<u32, String> {
    Ok(get_required_java_major(&mc_version))
}

#[tauri::command]
fn reiniciar_aplicativo(app: tauri::AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LauncherState::new())
        .manage(EstadoDiscordPresence::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_instances,
            create_instance,
            launch_instance,
            launch_instance_to_server,
            get_minecraft_versions,
            get_loader_versions, // Busca versões de loaders (Fabric, Forge, NeoForge)
            delete_instance,
            open_browser,
            auth::start_microsoft_login, // Mantendo o antigo por precaução
            auth::finish_microsoft_login,
            auth::check_auth_status,
            auth::logout,                 // Logout e limpeza de sessão
            auth::list_minecraft_accounts,
            auth::switch_minecraft_account,
            auth::remove_minecraft_account,
            auth::refresh_token,          // Renovar token automaticamente
            auth_sisu::login_microsoft_sisu, // Novo fluxo unificado SISU
            discord_social::login_discord_social,
            skin::upload_skin,               // Upload de skin
            // Gerenciador de mods
            search_mods_online,
            install_mod,
            install_project_file,
            install_curseforge_project_file,
            get_installed_mods,
            get_installed_resourcepacks,
            get_installed_shaders,
            // Gerenciamento de instâncias
            get_instance_details,
            update_instance_name,
            update_instance_settings,
            rename_instance_folder,
            // Gerenciamento de mundos
            get_worlds,
            get_servers,
            ping_server,
            add_server,
            remove_server,
            delete_world,
            // Gerenciamento de logs
            get_log_files,
            get_log_content,
            delete_log_file,
            // Remoção de mods
            remove_mod,
            remove_project_file,
            // Monitoramento do Minecraft
            is_instance_running,
            get_running_instances,
            kill_instance,
            // Modpacks
            save_modpack_info,
            install_modpack_files,
            get_modpack_info,
            check_modpack_updates,
            get_minecraft_news,
            get_launcher_friends,
            get_launcher_social_profile,
            save_launcher_social_profile,
            send_launcher_friend_request_by_handle,
            respond_launcher_friend_request,
            remove_launcher_friend,
            get_launcher_chat_messages,
            send_launcher_chat_message,
            link_launcher_minecraft_account,
            unlink_launcher_minecraft_account,
            refresh_launcher_social_session,
            logout_launcher_social,
            // Gerenciamento de Java e configurações
            get_settings,
            save_settings,
            get_system_ram,
            detect_java_installations,
            install_java,
            ensure_java_for_version,
            get_required_java,
            reiniciar_aplicativo,
            atualizar_discord_presence,
            encerrar_discord_presence,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
