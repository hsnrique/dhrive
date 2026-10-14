mod account;
mod approvals;
mod army;
mod attachments;
mod browser;
mod cancel;
mod changes;
mod checks;
mod connectors;
mod feedback;
mod clis;
mod company;
mod documents;
mod power;
mod github;
mod site_domains;
mod versions;
mod connections;
mod context;
mod conversations;
mod delete;
mod deleted;
mod engine;
mod env;
mod events;
mod files;
mod flow;
mod founding;
mod git;
mod instructions;
mod jsonl;
mod lists;
mod local;
mod models;
mod notify;
mod pane_launch;
mod preview;
mod proc;
mod progress;
mod prompts;
mod records;
mod rules;
mod projects;
mod publish;
mod search;
mod secrets;
mod sessions;
mod shell_env;
mod site;
mod terminal;
mod together;
mod usage;
mod viewer;
mod worktrees;

// Check for a new dhrive release on launch and stage it silently; the update applies the
// next time the app is opened, so users never re-download manually.
async fn update_in_background(app: tauri::AppHandle) {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;
    let Ok(updater) = app.updater() else {
        return;
    };
    if let Ok(Some(update)) = updater.check().await {
        let version = update.version.clone();
        // Stage it silently; it applies on next launch. Then nudge the UI so the user can
        // restart now instead of waiting to stumble onto the new version.
        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
            let _ = app.emit("dhrive-update", version);
        }
    }
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must run before anything spawns a child process, so CLI tools resolve in release builds.
    shell_env::hydrate_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            tauri::async_runtime::spawn(update_in_background(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            restart_app,
            clis::list_clis,
            models::list_models,
            usage::plan_usage,
            account::account_status,
            account::sign_in,
            account::cancel_sign_in,
            account::sign_out,
            connections::list_connections,
            context::context_usage,
            context::compact_session,
            flow::pick_folder,
            flow::run_step,
            cancel::stop_run,
            attachments::save_attachment,
            attachments::pick_files,
            attachments::reveal_file,
            files::list_files,
            files::open_file,
            viewer::read_file,
            notify::notify,
            preview::dev_servers,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            worktrees::remove_pane_copy,
            together::bring_panes_together,
            together::open_together_pull_request,
            browser::preview_show,
            browser::preview_place,
            browser::preview_hide,
            browser::preview_reload,
            changes::file_diff,
            changes::undo_changes,
            git::git_info,
            git::commit_step,
            git::open_pull_request,
            projects::list_projects,
            projects::add_project,
            projects::rename_project,
            delete::delete_company,
            company::read_company,
            publish::publish_site,
            publish::build_site,
            site::site_state,
            site::run_site,
            site::stop_site,
            founding::founding_dir,
            founding::found_company,
            company::save_company,
            records::read_company_record,
            records::save_company_record,
            records::archive_company_record,
            documents::read_documents,
            power::keep_awake,
            github::github_state,
            github::save_to_github,
            github::pending_changes,
            connectors::connectors,
            connectors::connector_open,
            army::army_prepare,
            army::army_sync,
            army::army_land,
            army::army_changes,
            army::army_discard,
            feedback::suggest_tool,
            feedback::send_feedback,
            checks::run_checks,
            env::env_view,
            env::env_set,
            env::env_remove,
            env::env_restore,
            env::env_reveal,
            github::github_sign_in,
            versions::site_releases,
            versions::site_published,
            versions::make_release_live,
            site_domains::site_domains,
            site_domains::add_site_domain,
            site_domains::check_site_domain,
            site_domains::remove_site_domain,
            instructions::read_instructions,
            instructions::save_instructions,
            rules::allow_in_project,
            rules::disallow_in_project,
            approvals::answer_approval,
            projects::load_thread,
            projects::save_thread,
            conversations::list_conversations,
            conversations::save_conversation,
            conversations::remove_conversation,
            search::search_conversations,
            sessions::list_sessions,
            local::scan_local,
            local::pull_model,
            local::start_ollama
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // A company's website never outlives dhrive.
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                site::stop_all();
            }
        });
}
