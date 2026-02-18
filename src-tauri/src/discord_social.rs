use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContaMinecraftSocial {
    pub uuid: String,
    pub nome: String,
    pub vinculado_em: String,
    pub ultimo_uso_em: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfilSocialDiscord {
    pub perfil_id: String,
    pub discord_id: String,
    pub discord_username: String,
    pub discord_global_name: Option<String>,
    pub discord_avatar: Option<String>,
    pub handle: String,
    pub nome_social: String,
    pub contas_minecraft_vinculadas: Vec<ContaMinecraftSocial>,
    pub conta_minecraft_principal_uuid: Option<String>,
    pub online: bool,
    pub ultimo_seen_em: Option<String>,
    pub criado_em: String,
    pub atualizado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessaoSocialDiscord {
    pub access_token: String,
    pub refresh_token: String,
    pub expira_em: String,
    pub perfil: PerfilSocialDiscord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BodyExchangeDiscord {
    code: String,
    code_verifier: String,
    redirect_uri: String,
}

fn normalizar_api_base_url(api_base_url: &str) -> Result<String, String> {
    let api_base = api_base_url.trim().trim_end_matches('/').to_string();
    if api_base.is_empty() {
        return Err("URL da API do launcher nao configurada.".to_string());
    }
    if !api_base.starts_with("http://") && !api_base.starts_with("https://") {
        return Err("URL da API do launcher invalida.".to_string());
    }
    Ok(api_base)
}

fn gerar_code_verifier() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn gerar_code_challenge(code_verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

#[tauri::command]
pub async fn login_discord_social(
    app: AppHandle,
    api_base_url: String,
    client_id: String,
    redirect_uri: String,
    scope: Option<String>,
) -> Result<SessaoSocialDiscord, String> {
    let api_base_url = normalizar_api_base_url(&api_base_url)?;
    let client_id = client_id.trim().to_string();
    let redirect_uri = redirect_uri.trim().to_string();
    let scope = scope.unwrap_or_else(|| "identify".to_string()).trim().to_string();

    if client_id.is_empty() || redirect_uri.is_empty() {
        return Err("Parametros Discord incompletos para autenticacao social.".to_string());
    }

    let code_verifier = gerar_code_verifier();
    let code_challenge = gerar_code_challenge(&code_verifier);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Falha ao iniciar callback local: {}", e))?;
    let porta = listener
        .local_addr()
        .map_err(|e| format!("Falha ao descobrir porta local: {}", e))?
        .port();

    let estado = uuid::Uuid::new_v4().to_string();
    let mut url = url::Url::parse("https://discord.com/oauth2/authorize")
        .map_err(|e| format!("Falha ao montar URL OAuth: {}", e))?;

    url.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", &scope)
        .append_pair("prompt", "consent")
        .append_pair("state", &estado)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256");

    let script = format!(
        r#"
        (function() {{
            const check = setInterval(() => {{
                const href = window.location.href;
                if (href.includes("code=") || href.includes("error=")) {{
                    clearInterval(check);
                    window.location.href = "http://127.0.0.1:{}/callback?final_url=" + encodeURIComponent(href);
                }}
            }}, 400);
        }})();
        "#,
        porta
    );

    let label = "discord-social-auth-window";
    if let Some(janela_existente) = app.get_webview_window(label) {
        let _ = janela_existente.close();
    }

    let _janela = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title("Entrar com Discord")
        .inner_size(500.0, 650.0)
        .initialization_script(&script)
        .build()
        .map_err(|e| format!("Falha ao abrir janela de autenticacao: {}", e))?;

    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|e| format!("Falha ao receber callback OAuth: {}", e))?;

    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| format!("Falha ao ler callback OAuth: {}", e))?;

    let resposta_html = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body style='font-family:sans-serif;background:#0d0d0d;color:white;display:flex;align-items:center;justify-content:center;height:100vh'><div><h2>Discord conectado</h2><p>Voce ja pode voltar para o launcher.</p><script>setTimeout(()=>window.close(), 1200)</script></div></body></html>";
    let _ = stream.write_all(resposta_html.as_bytes()).await;

    if let Some(janela) = app.get_webview_window(label) {
        let _ = janela.close();
    }

    let caminho_requisicao = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("Callback OAuth invalido".to_string())?;

    let final_url_codificada = caminho_requisicao
        .split("final_url=")
        .nth(1)
        .ok_or("Resposta OAuth sem URL final".to_string())?;

    let final_url = urlencoding::decode(final_url_codificada)
        .map_err(|_| "Falha ao decodificar retorno OAuth".to_string())?
        .to_string();

    let final_url = url::Url::parse(&final_url).map_err(|_| "URL final OAuth invalida".to_string())?;
    let query_params: std::collections::HashMap<String, String> =
        final_url.query_pairs().into_owned().collect();

    if let Some(erro) = query_params.get("error") {
        return Err(format!("Discord OAuth retornou erro: {}", erro));
    }

    let estado_retorno = query_params
        .get("state")
        .ok_or("Estado OAuth ausente".to_string())?;
    if estado_retorno != &estado {
        return Err("Estado OAuth invalido. Tente novamente.".to_string());
    }

    let code = query_params
        .get("code")
        .ok_or("Codigo OAuth nao encontrado no retorno.".to_string())?
        .to_string();

    let body = BodyExchangeDiscord {
        code,
        code_verifier,
        redirect_uri,
    };

    let endpoint = format!("{}/api/launcher/auth/discord/exchange", api_base_url);
    let client = Client::new();
    let resposta = client
        .post(&endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Falha ao autenticar com API social: {}", e))?;

    if !resposta.status().is_success() {
        let texto = resposta.text().await.unwrap_or_default();
        return Err(format!("API social retornou erro: {}", texto));
    }

    resposta
        .json::<SessaoSocialDiscord>()
        .await
        .map_err(|e| format!("Resposta da API social invalida: {}", e))
}
