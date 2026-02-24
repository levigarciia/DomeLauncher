use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AmigoLauncherApi {
    pub amizade_id: String,
    pub friend_profile_id: String,
    pub nome: String,
    pub handle: Option<String>,
    pub online: bool,
    pub ultimo_seen_em: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SolicitacaoRecebidaAmizadeApi {
    pub id: String,
    pub de_perfil_id: String,
    pub de_handle: Option<String>,
    pub de_nome: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SolicitacaoEnviadaAmizadeApi {
    pub id: String,
    pub para_perfil_id: String,
    pub para_handle: Option<String>,
    pub para_nome: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RespostaAmigosLauncherApi {
    #[serde(default)]
    pub amigos: Vec<AmigoLauncherApi>,
    #[serde(default)]
    pub pendentes_recebidas: Vec<SolicitacaoRecebidaAmizadeApi>,
    #[serde(default)]
    pub pendentes_enviadas: Vec<SolicitacaoEnviadaAmizadeApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContaMinecraftSocialLauncherApi {
    pub uuid: String,
    pub nome: String,
    pub vinculado_em: String,
    pub ultimo_uso_em: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfilSocialLauncherApi {
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
pub struct PayloadSalvarPerfilSocialLauncherApi {
    pub nome_social: Option<String>,
    pub handle: Option<String>,
    pub conta_minecraft_principal_uuid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RespostaSalvarPerfilSocialLauncherApi {
    pub sucesso: Option<bool>,
    pub perfil: Option<PerfilSocialLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadSolicitarAmizadeHandleLauncherApi {
    pub handle: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MensagemChatLauncherApi {
    pub id: String,
    pub de_perfil_id: String,
    pub para_perfil_id: String,
    pub conteudo: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RespostaMensagensChatLauncherApi {
    pub conversa_id: String,
    #[serde(default)]
    pub mensagens: Vec<MensagemChatLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadEnviarMensagemChatLauncherApi {
    pub para_perfil_id: String,
    pub conteudo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadVincularMinecraftSocialLauncherApi {
    pub uuid: String,
    pub nome: String,
    pub minecraft_access_token: String,
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

pub async fn extrair_mensagem_erro_launcher(resposta: reqwest::Response, contexto: &str) -> String {
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
pub async fn get_launcher_friends(
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
pub async fn get_launcher_social_profile(
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
pub async fn save_launcher_social_profile(
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
pub async fn send_launcher_friend_request_by_handle(
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
pub async fn get_launcher_chat_messages(
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
pub async fn send_launcher_chat_message(
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
pub async fn respond_launcher_friend_request(
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
pub async fn remove_launcher_friend(
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
pub async fn link_launcher_minecraft_account(
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
pub async fn unlink_launcher_minecraft_account(
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
pub async fn refresh_launcher_social_session(
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
pub async fn logout_launcher_social(
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
