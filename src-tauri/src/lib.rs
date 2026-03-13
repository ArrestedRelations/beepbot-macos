use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::Mutex;
use std::path::PathBuf;

struct SidecarState {
    child: Option<std::process::Child>,
}

#[tauri::command]
fn get_sidecar_port() -> u16 {
    3004
}

fn get_project_root() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir).parent().unwrap().to_path_buf()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(SidecarState { child: None }))
        .invoke_handler(tauri::generate_handler![get_sidecar_port])
        .setup(|app| {
            // --- Native menu bar ---
            let app_handle = app.handle();
            let menu_bar = Menu::default(&app_handle)?;
            app.set_menu(menu_bar)?;

            // --- Tray icon setup ---
            let quit = MenuItem::with_id(app, "quit", "Quit BeepBot", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&quit])?;

            TrayIconBuilder::with_id("beepbot-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("BeepBot")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let (ix, iy, iw, ih) = match (&rect.position, &rect.size) {
                                    (tauri::Position::Physical(p), tauri::Size::Physical(s)) =>
                                        (p.x as f64, p.y as f64, s.width as f64, s.height as f64),
                                    (tauri::Position::Logical(p), tauri::Size::Logical(s)) =>
                                        (p.x, p.y, s.width, s.height),
                                    _ => (0.0, 0.0, 0.0, 0.0),
                                };

                                let scale = window.scale_factor().unwrap_or(1.0);
                                let window_width = 480.0;
                                let center_x = (ix + iw / 2.0) / scale;
                                let top_y = (iy + ih) / scale + 4.0;
                                let x = center_x - (window_width / 2.0);

                                let _ = window.set_position(tauri::Position::Logical(
                                    tauri::LogicalPosition::new(x, top_y),
                                ));
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        let state = app.state::<Mutex<SidecarState>>();
                        let mut guard = state.lock().unwrap();
                        if let Some(ref mut child) = guard.child {
                            let _ = child.kill();
                            println!("Sidecar killed (quit via tray)");
                        }
                        guard.child = None;
                        app.exit(0);
                    }
                })
                .build(app)?;

            // --- Sidecar startup ---
            let sidecar_running = std::net::TcpStream::connect_timeout(
                &"127.0.0.1:3004".parse().unwrap(),
                std::time::Duration::from_millis(500),
            ).is_ok();

            if sidecar_running {
                println!("Sidecar already running on :3004 (daemon mode — skipping spawn)");
            } else {
                let project_root = get_project_root();
                let sidecar_dir = project_root.join("sidecar");

                let child = if cfg!(debug_assertions) {
                    let npx = if cfg!(target_os = "windows") { "npx.cmd" } else { "npx" };
                    std::process::Command::new(npx)
                        .arg("tsx")
                        .arg("watch")
                        .arg(sidecar_dir.join("src").join("index.ts"))
                        .env("PORT", "3004")
                        .current_dir(&sidecar_dir)
                        .spawn()
                } else {
                    std::process::Command::new("node")
                        .arg(sidecar_dir.join("dist").join("index.js"))
                        .env("PORT", "3004")
                        .current_dir(&sidecar_dir)
                        .spawn()
                };

                match child {
                    Ok(child) => {
                        let state = app.state::<Mutex<SidecarState>>();
                        state.lock().unwrap().child = Some(child);
                        println!("Sidecar started on port 3004 (dir: {})", sidecar_dir.display());
                    }
                    Err(e) => {
                        eprintln!("Failed to start sidecar: {}", e);
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Destroyed => {
                    let state = window.app_handle().state::<Mutex<SidecarState>>();
                    let mut guard = state.lock().unwrap();
                    if let Some(ref mut child) = guard.child {
                        let _ = child.kill();
                        println!("Sidecar killed");
                    }
                    guard.child = None;
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
