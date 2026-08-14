use reqwest::multipart::{Form, Part};
use reqwest::Client;
use std::borrow::Cow;
use tauri::command;

#[derive(serde::Deserialize)]
struct PerfilSkinMinecraft {
    #[serde(default)]
    skins: Vec<SkinMinecraft>,
}

#[derive(serde::Deserialize)]
struct SkinMinecraft {
    #[serde(default)]
    state: String,
    #[serde(default)]
    variant: String,
}

fn variante_skin_do_perfil(perfil: &PerfilSkinMinecraft) -> String {
    let skin = perfil
        .skins
        .iter()
        .find(|skin| skin.state.eq_ignore_ascii_case("active"))
        .or_else(|| perfil.skins.first());

    match skin.map(|skin| skin.variant.as_str()) {
        Some(variante) if variante.eq_ignore_ascii_case("slim") => "slim".to_string(),
        _ => "classic".to_string(),
    }
}

#[command]
pub async fn obter_variante_skin_atual(access_token: String) -> Result<String, String> {
    let resposta = Client::new()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Falha ao consultar skin atual: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "Não foi possível consultar a skin atual ({})",
            resposta.status()
        ));
    }

    let perfil = resposta
        .json::<PerfilSkinMinecraft>()
        .await
        .map_err(|e| format!("Resposta de skin inválida: {}", e))?;
    Ok(variante_skin_do_perfil(&perfil))
}

#[command]
pub async fn upload_skin(
    access_token: String,
    variant: String,
    skin_bytes: Vec<u8>,
) -> Result<(), String> {
    let client = Client::new();

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

#[cfg(test)]
mod testes {
    use super::{variante_skin_do_perfil, PerfilSkinMinecraft, SkinMinecraft};

    #[test]
    fn prioriza_variante_da_skin_ativa() {
        let perfil = PerfilSkinMinecraft {
            skins: vec![
                SkinMinecraft {
                    state: "INACTIVE".to_string(),
                    variant: "CLASSIC".to_string(),
                },
                SkinMinecraft {
                    state: "ACTIVE".to_string(),
                    variant: "SLIM".to_string(),
                },
            ],
        };

        assert_eq!(variante_skin_do_perfil(&perfil), "slim");
    }
}
