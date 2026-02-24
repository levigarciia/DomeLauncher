use crate::comandos::configuracoes_java::GlobalSettings;
use crate::timestamp_atual_segundos;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use tauri::State;

const DISCORD_RPC_APP_ID: &str = "1380421346605138041";
const DISCORD_RPC_CLIENT_ID: &str = "1380421346605138041";
const DISCORD_RPC_URL_SITE: &str = "https://domestudios.com.br/domelauncher";
const DISCORD_RPC_URL_DISCORD: &str = "https://discord.domestudios.com.br";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresencaDiscordPayload {
    pub detalhes: String,
    pub estado: Option<String>,
}

#[derive(Default)]
pub struct EstadoDiscordPresence {
    pub cliente: std::sync::Mutex<Option<DiscordIpcClient>>,
    pub ultimo_payload: std::sync::Mutex<Option<PresencaDiscordPayload>>,
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
pub async fn atualizar_discord_presence(
    estado_presence: State<'_, EstadoDiscordPresence>,
    payload: PresencaDiscordPayload,
) -> Result<(), String> {
    let settings = crate::comandos::configuracoes_java::get_settings().await.unwrap_or_default();
    aplicar_discord_presence(&estado_presence, &settings, payload)
}

#[tauri::command]
pub fn encerrar_discord_presence(estado_presence: State<'_, EstadoDiscordPresence>) -> Result<(), String> {
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
