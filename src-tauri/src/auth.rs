use crate::launcher::{LauncherState, MinecraftAccount};
use base64::{engine::general_purpose, Engine as _};
use rand::Rng; // Add rand to Cargo.toml
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256}; // Add sha2 to Cargo.toml
use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::State; // Add base64 to Cargo.toml

// Prism Launcher Client ID (Supports localhost redirect & PKCE)
const CLIENT_ID: &str = "ba495809-4e0c-442d-a617-65715c2b9608";

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct XblRequest {
    #[serde(rename = "Properties")]
    properties: XblProperties,
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct XblProperties {
    #[serde(rename = "AuthMethod")]
    auth_method: String,
    #[serde(rename = "SiteName")]
    site_name: String,
    #[serde(rename = "RpsTicket")]
    rps_ticket: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct McLoginRequest {
    #[serde(rename = "identityToken")]
    identity_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct McProfile {
    id: String,
    name: String,
}

// Helper: PKCE Generator
fn generate_pkce_verifier() -> String {
    let mut rng = rand::thread_rng();
    let mut bytes = [0u8; 32];
    rng.fill(&mut bytes);
    general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    general_purpose::URL_SAFE_NO_PAD.encode(hash)
}

#[tauri::command]
pub async fn start_microsoft_login(
    state: State<'_, LauncherState>,
) -> Result<MinecraftAccount, String> {
    // 1. Setup Local Server
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{}", port); // Must be localhost, not 127.0.0.1 for strict matching sometimes? No, Azure allows http://localhost

    // 2. Prepare PKCE
    let verifier = generate_pkce_verifier();
    let challenge = generate_pkce_challenge(&verifier);
    let state_token = generate_pkce_verifier(); // Random state

    // 3. Construct Auth URL
    let auth_url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id={}&response_type=code&redirect_uri={}&scope=XboxLive.signin%20offline_access&code_challenge={}&code_challenge_method=S256&state={}",
        CLIENT_ID,
        urlencoding::encode(&redirect_uri),
        challenge,
        state_token
    );

    println!("Opening Auth URL: {}", auth_url);

    // 4. Open Browser
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &auth_url.replace("&", "^&")]) // Escape & for cmd
        .spawn()
        .map_err(|e| e.to_string())?;

    // 5. Wait for Code
    let mut code = String::new();

    // Accept EXACTLY one connection
    match listener.accept() {
        Ok((mut stream, _)) => {
            let mut buffer = [0; 2048];
            stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer);

            // Extract code
            // GET /?code=M.R3_...&state=... HTTP/1.1
            if let Some(start) = request.find("code=") {
                let rest = &request[start + 5..];
                if let Some(end) = rest.find(&[' ', '&'][..]) {
                    code = rest[..end].to_string();
                }
            }

            // Return Response to Browser
            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n
            <html>
            <body style='background-color: #121214; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;'>
                <div style='text-align: center'>
                    <h1 style='color: #34d399'>Login Iniciado!</h1>
                    <p>Você pode fechar esta janela e voltar para o Launcher.</p>
                    <script>setTimeout(function(){window.close()}, 2000);</script>
                </div>
            </body>
            </html>";
            stream.write(response.as_bytes()).unwrap();
            stream.flush().unwrap();
        }
        Err(e) => return Err(format!("Falha ao receber conexão: {}", e)),
    }

    if code.is_empty() {
        return Err("Falha: Código de autorização não recebido.".to_string());
    }

    // 6. Exchange Code for Token
    let client = Client::new();
    let token_res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("scope", "XboxLive.signin offline_access"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
            ("code_verifier", &verifier),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = token_res.status(); // Capture needed data before consuming response
    if !status.is_success() {
        let text = token_res.text().await.unwrap_or_default();
        return Err(format!("Erro ao obter token: {} - {}", status, text));
    }

    let token_data: TokenResponse = token_res.json().await.map_err(|e| e.to_string())?;
    let ms_access_token = token_data.access_token;

    // 7. Xbox Live Auth
    let xbl_req = XblRequest {
        properties: XblProperties {
            auth_method: "RPS".to_string(),
            site_name: "user.auth.xboxlive.com".to_string(),
            rps_ticket: format!("d={}", ms_access_token),
        },
        relying_party: "http://auth.xboxlive.com".to_string(),
        token_type: "JWT".to_string(),
    };

    let xbl_res = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&xbl_req)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<XblResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let uhs = xbl_res.display_claims["xui"][0]["uhs"]
        .as_str()
        .ok_or("UHS não encontrado")?;
    let xbl_token = xbl_res.token;

    // 8. XSTS Auth
    let xsts_res = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<XblResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let xsts_token = xsts_res.token;

    // 9. Minecraft Auth
    let mc_res = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&McLoginRequest {
            identity_token: format!("XBL3.0 x={};{}", uhs, xsts_token),
        })
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mc_access_token = mc_res["access_token"]
        .as_str()
        .ok_or("MC Token falhou")?
        .to_string();

    // 10. Get Profile
    let profile_res = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", mc_access_token))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<McProfile>()
        .await
        .map_err(|e| e.to_string())?;

    let account = MinecraftAccount {
        id: profile_res.id.clone(),
        uuid: profile_res.id,
        name: profile_res.name,
        access_token: mc_access_token,
        refresh_token: None,
        expires_at: None,
        token_type: "Bearer".to_string(),
    };

    // Salvar no estado
    if let Ok(mut lock) = state.account.lock() {
        *lock = Some(account.clone());
    }

    Ok(account)
}

// Stub para manter compatibilidade por enquanto (não será usado)
#[tauri::command]
pub async fn finish_microsoft_login(
    _state: State<'_, LauncherState>,
    _device_code: String,
) -> Result<MinecraftAccount, String> {
    Err("Função obsoleta".to_string())
}

#[tauri::command]
pub fn check_auth_status(state: State<LauncherState>) -> Option<MinecraftAccount> {
    if let Ok(lock) = state.account.lock() {
        lock.clone()
    } else {
        None
    }
}

#[tauri::command]
pub fn logout(state: State<LauncherState>) -> Result<(), String> {
    state.clear_account()
}

#[tauri::command]
pub fn list_minecraft_accounts(state: State<LauncherState>) -> Vec<MinecraftAccount> {
    state.list_accounts()
}

#[tauri::command]
pub fn switch_minecraft_account(
    state: State<LauncherState>,
    uuid: String,
) -> Result<MinecraftAccount, String> {
    state.set_active_account(uuid.trim())
}

#[tauri::command]
pub fn remove_minecraft_account(state: State<LauncherState>, uuid: String) -> Result<(), String> {
    state.remove_account(uuid.trim())
}

pub async fn refresh_token_interno(state: &LauncherState) -> Result<MinecraftAccount, String> {
    crate::auth_sisu::refresh_token_sisu_interno(state).await
}

/// Renova o token de acesso usando o refresh_token salvo
#[tauri::command]
pub async fn refresh_token(state: State<'_, LauncherState>) -> Result<MinecraftAccount, String> {
    refresh_token_interno(&state).await
}
