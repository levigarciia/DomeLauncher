use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfilDiscordSocial {
    pub id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
    pub handle: String,
}

#[derive(Debug, Deserialize)]
struct RespostaTokenDiscord {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct RespostaUsuarioDiscord {
    id: String,
    username: String,
    global_name: Option<String>,
    avatar: Option<String>,
}

fn normalizar_handle_discord(username: &str) -> String {
    username.trim().to_lowercase()
}

#[tauri::command]
pub async fn login_discord_social(
    app: AppHandle,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    scope: Option<String>,
) -> Result<PerfilDiscordSocial, String> {
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    let redirect_uri = redirect_uri.trim().to_string();
    let scope = scope.unwrap_or_else(|| "identify".to_string());
    let scope = scope.trim().to_string();

    if client_id.is_empty() || client_secret.is_empty() || redirect_uri.is_empty() {
        return Err("Credenciais Discord incompletas para autenticação social.".to_string());
    }

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
        .append_pair("state", &estado);

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
        .map_err(|e| format!("Falha ao abrir janela de autenticação: {}", e))?;

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

    let resposta_html = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body style='font-family:sans-serif;background:#0d0d0d;color:white;display:flex;align-items:center;justify-content:center;height:100vh'><div><h2>Discord conectado</h2><p>Você já pode voltar para o launcher.</p><script>setTimeout(()=>window.close(), 1200)</script></div></body></html>";
    let _ = stream.write_all(resposta_html.as_bytes()).await;

    if let Some(janela) = app.get_webview_window(label) {
        let _ = janela.close();
    }

    let caminho_requisicao = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("Callback OAuth inválido".to_string())?;

    let final_url_codificada = caminho_requisicao
        .split("final_url=")
        .nth(1)
        .ok_or("Resposta OAuth sem URL final".to_string())?;

    let final_url = urlencoding::decode(final_url_codificada)
        .map_err(|_| "Falha ao decodificar retorno OAuth".to_string())?
        .to_string();

    let final_url = url::Url::parse(&final_url).map_err(|_| "URL final OAuth inválida".to_string())?;
    let query_params: std::collections::HashMap<String, String> =
        final_url.query_pairs().into_owned().collect();

    if let Some(erro) = query_params.get("error") {
        return Err(format!("Discord OAuth retornou erro: {}", erro));
    }

    let estado_retorno = query_params
        .get("state")
        .ok_or("Estado OAuth ausente".to_string())?;
    if estado_retorno != &estado {
        return Err("Estado OAuth inválido. Tente novamente.".to_string());
    }

    let codigo = query_params
        .get("code")
        .ok_or("Código OAuth não encontrado no retorno.".to_string())?
        .to_string();

    let client = Client::new();
    let resposta_token = client
        .post("https://discord.com/api/v10/oauth2/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", codigo.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Falha ao obter token Discord: {}", e))?;

    if !resposta_token.status().is_success() {
        let texto = resposta_token.text().await.unwrap_or_default();
        return Err(format!("Discord token inválido: {}", texto));
    }

    let token: RespostaTokenDiscord = resposta_token
        .json()
        .await
        .map_err(|e| format!("Resposta token Discord inválida: {}", e))?;

    let resposta_usuario = client
        .get("https://discord.com/api/v10/users/@me")
        .header("Authorization", format!("Bearer {}", token.access_token))
        .send()
        .await
        .map_err(|e| format!("Falha ao obter perfil Discord: {}", e))?;

    if !resposta_usuario.status().is_success() {
        let texto = resposta_usuario.text().await.unwrap_or_default();
        return Err(format!("Discord perfil inválido: {}", texto));
    }

    let usuario: RespostaUsuarioDiscord = resposta_usuario
        .json()
        .await
        .map_err(|e| format!("Resposta de perfil Discord inválida: {}", e))?;

    Ok(PerfilDiscordSocial {
        id: usuario.id,
        username: usuario.username.clone(),
        global_name: usuario.global_name,
        avatar: usuario.avatar,
        handle: normalizar_handle_discord(&usuario.username),
    })
}
