use super::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LauncherState::new())
        .manage(crate::comandos::presenca_discord::EstadoDiscordPresence::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            super::instancias_basicas::get_instances,
            super::importacao_exportacao::listar_instancias_importaveis,
            super::importacao_exportacao::importar_instancias_externas,
            super::instancias_criacao::create_instance,
            super::lancamento_jogo::launch_instance,
            super::lancamento_jogo::launch_instance_to_server,
            super::instancias_basicas::get_minecraft_versions,
            super::instancias_criacao::get_loader_versions, // Busca versões de loaders (Fabric, Forge, NeoForge)
            super::instancias_basicas::delete_instance,
            super::instancias_basicas::open_browser,
            crate::auth::start_microsoft_login, // Mantendo o antigo por precaução
            crate::auth::finish_microsoft_login,
            crate::auth::check_auth_status,
            crate::auth::logout,                 // Logout e limpeza de sessão
            crate::auth::list_minecraft_accounts,
            crate::auth::switch_minecraft_account,
            crate::auth::remove_minecraft_account,
            crate::auth::refresh_token,          // Renovar token automaticamente
            crate::auth_sisu::login_microsoft_sisu, // Novo fluxo unificado SISU
            crate::discord_social::login_discord_social,
            crate::skin::upload_skin,               // Upload de skin
            // Gerenciador de mods
            super::mods_conteudo::search_mods_online,
            super::mods_conteudo::buscar_detalhes_projeto_curseforge,
            super::mods_conteudo::install_mod,
            super::mods_conteudo::install_project_file,
            super::mods_conteudo::install_curseforge_project_file,
            super::mods_conteudo::resolver_modpack_curseforge,
            super::mods_conteudo::get_installed_mods,
            super::mods_conteudo::get_installed_resourcepacks,
            super::mods_conteudo::get_installed_shaders,
            // Gerenciamento de instâncias
            super::instancias_basicas::get_instance_details,
            super::instancias_basicas::update_instance_name,
            super::instancias_basicas::update_instance_settings,
            super::instancias_basicas::rename_instance_folder,
            // Exportação / Importação de instâncias
            super::importacao_exportacao::exportar_instancia,
            super::importacao_exportacao::importar_instancia_arquivo,
            super::importacao_exportacao::escolher_pasta_exportacao,
            super::importacao_exportacao::escolher_arquivo_importacao,
            // Gerenciamento de mundos
            crate::comandos::instancia_sistema::get_worlds,
            crate::comandos::instancia_sistema::get_servers,
            crate::comandos::instancia_sistema::ping_server,
            crate::comandos::instancia_sistema::add_server,
            crate::comandos::instancia_sistema::remove_server,
            crate::comandos::instancia_sistema::delete_world,
            // Gerenciamento de logs
            crate::comandos::logs_instancia::get_log_files,
            crate::comandos::logs_instancia::get_log_content,
            crate::comandos::logs_instancia::delete_log_file,
            // Remoção de mods
            super::mods_conteudo::remove_mod,
            super::mods_conteudo::remove_project_file,
            super::mods_conteudo::toggle_project_file_enabled,
            // Monitoramento do Minecraft
            crate::comandos::instancia_sistema::is_instance_running,
            crate::comandos::instancia_sistema::get_running_instances,
            crate::comandos::instancia_sistema::kill_instance,
            // Modpacks
            crate::comandos::modpacks::save_modpack_info,
            crate::comandos::modpacks::install_modpack_files,
            crate::comandos::modpacks::get_modpack_info,
            crate::comandos::modpacks::check_modpack_updates,
            crate::comandos::noticias_minecraft::get_minecraft_news,
            crate::comandos::social_launcher::get_launcher_friends,
            crate::comandos::social_launcher::get_launcher_social_profile,
            crate::comandos::social_launcher::save_launcher_social_profile,
            crate::comandos::social_launcher::set_launcher_social_status,
            crate::comandos::social_launcher::send_launcher_friend_request_by_handle,
            crate::comandos::social_launcher::cancel_launcher_friend_request,
            crate::comandos::social_launcher::respond_launcher_friend_request,
            crate::comandos::social_launcher::remove_launcher_friend,
            crate::comandos::social_launcher::get_launcher_chat_messages,
            crate::comandos::social_launcher::send_launcher_chat_message,
            crate::comandos::social_launcher::link_launcher_minecraft_account,
            crate::comandos::social_launcher::unlink_launcher_minecraft_account,
            crate::comandos::social_launcher::export_launcher_social_sync_package,
            crate::comandos::social_launcher::upload_launcher_social_sync_package,
            crate::comandos::social_launcher::download_import_launcher_social_sync_package,
            crate::comandos::social_launcher::refresh_launcher_social_session,
            crate::comandos::social_launcher::logout_launcher_social,
            // Gerenciamento de Java e configurações
            crate::comandos::configuracoes_java::get_settings,
            crate::comandos::configuracoes_java::save_settings,
            crate::comandos::configuracoes_java::get_system_ram,
            crate::comandos::configuracoes_java::detect_java_installations,
            crate::comandos::configuracoes_java::install_java,
            crate::comandos::configuracoes_java::ensure_java_for_version,
            crate::comandos::configuracoes_java::get_required_java,
            super::instancias_basicas::reiniciar_aplicativo,
            crate::comandos::presenca_discord::atualizar_discord_presence,
            crate::comandos::presenca_discord::encerrar_discord_presence,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}








