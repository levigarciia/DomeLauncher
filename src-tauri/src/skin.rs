use reqwest::multipart::{Form, Part};
use reqwest::Client;
use std::borrow::Cow;
use tauri::command;

#[command]
pub async fn upload_skin(
    access_token: String,
    variant: String,
    skin_bytes: Vec<u8>,
) -> Result<(), String> {
    let client = Client::new();

    // Create multipart form
    // variant must be "classic" or "slim"
    if variant != "classic" && variant != "slim" {
        return Err("Variante inválida. Use 'classic' ou 'slim'.".to_string());
    }

    let part = Part::bytes(Cow::from(skin_bytes))
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;

    let form = Form::new().text("variant", variant).part("file", part);

    let res = client
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Erro Mojang API ({}): {}", status, text));
    }

    Ok(())
}
