// Open Gravity desktop: a native window around the router's dashboard, with a
// tray icon, single-instance handling and the router core embedded in the binary.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};

const MAIN: &str = "main";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Prefs {
    close_to_tray: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self { close_to_tray: true }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Starting,
    Ready,
    Error,
}

struct Boot {
    phase: Phase,
    message: String,
}

struct DesktopState {
    core: Mutex<Option<core::CoreProcess>>,
    url: Mutex<Option<String>>,
    boot: Mutex<Boot>,
    logs: core::Logs,
    prefs: Mutex<Prefs>,
    quitting: AtomicBool,
    has_window: AtomicBool,
    booting: AtomicBool,
}

struct TrayItems {
    url: MenuItem<Wry>,
}

fn prefs_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("desktop.json"))
}

fn load_prefs(app: &AppHandle) -> Prefs {
    prefs_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_prefs(app: &AppHandle, prefs: &Prefs) {
    if let Some(f) = prefs_file(app) {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(f, serde_json::to_string_pretty(prefs).unwrap_or_default());
    }
}

fn dashboard_url(base: &str) -> String {
    format!("{}/ui/", base.trim_end_matches('/'))
}

fn is_local_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some(h) if h == "127.0.0.1" || h == "localhost" || h == "[::1]" || h.ends_with(".localhost")),
        _ => false,
    }
}

fn open_in_browser(url: &str) {
    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
}

fn show_main(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    } else if let Some(url) = state.url.lock().unwrap().clone() {
        open_in_browser(&dashboard_url(&url));
    }
}

fn set_boot(app: &AppHandle, phase: Phase, message: &str) {
    let state = app.state::<DesktopState>();
    let mut b = state.boot.lock().unwrap();
    b.phase = phase;
    b.message = message.to_string();
}

fn create_main_window(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let handle = app.clone();
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Open Gravity")
        .inner_size(1320.0, 860.0)
        .min_inner_size(980.0, 640.0)
        .center()
        .visible(visible)
        .on_navigation(move |url| {
            if is_local_url(url) {
                return true;
            }
            // Links to the outside world open in the user's browser.
            let _ = &handle;
            open_in_browser(url.as_str());
            false
        });
    #[cfg(target_os = "windows")]
    {
        // Frameless with the native shadow: Windows 11 draws rounded corners.
        builder = builder.decorations(false).shadow(true);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    }
    builder.build()?;
    Ok(())
}

fn navigate_to_dashboard(app: &AppHandle, base: &str) {
    let target = dashboard_url(base);
    if let Some(w) = app.get_webview_window(MAIN) {
        if let Ok(u) = Url::parse(&target) {
            let _ = w.navigate(u);
        }
    } else {
        open_in_browser(&target);
    }
}

/// Start (or attach to) the router, then show the dashboard.
fn boot(app: AppHandle, navigate: bool) {
    let state = app.state::<DesktopState>();
    if state.booting.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let state = app.state::<DesktopState>();
        set_boot(&app, Phase::Starting, "Starting…");
        let data_dir = app
            .path()
            .app_local_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("open-gravity-desktop"));
        let status_app = app.clone();
        let status = move |m: &str| set_boot(&status_app, Phase::Starting, m);
        match core::start(&data_dir, &state.logs, &status) {
            Ok(started) => {
                let url = match started {
                    core::Started::Managed(p, url) => {
                        *state.core.lock().unwrap() = Some(p);
                        url
                    }
                    core::Started::Attached(url) => url,
                };
                *state.url.lock().unwrap() = Some(url.clone());
                if let Some(items) = app.try_state::<TrayItems>() {
                    let _ = items.url.set_text(format!("Router: {url}"));
                }
                set_boot(&app, Phase::Ready, &url);
                if navigate {
                    navigate_to_dashboard(&app, &url);
                }
            }
            Err(e) => set_boot(&app, Phase::Error, &e),
        }
        state.booting.store(false, Ordering::SeqCst);
    });
}

/// Restart the router if it stops unexpectedly (at most 5 times in 10 minutes).
fn watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        let mut restarts: Vec<Instant> = Vec::new();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let state = app.state::<DesktopState>();
            if state.quitting.load(Ordering::SeqCst) {
                break;
            }
            let died = {
                let mut core = state.core.lock().unwrap();
                let dead = core.as_mut().map(|p| !p.is_running()).unwrap_or(false);
                if dead {
                    *core = None;
                }
                dead
            };
            if !died {
                continue;
            }
            restarts.retain(|t| t.elapsed() < Duration::from_secs(600));
            if restarts.len() >= 5 {
                set_boot(&app, Phase::Error, &format!("The router keeps stopping.\n{}", core::tail(&state.logs, 12)));
                continue;
            }
            restarts.push(Instant::now());
            boot(app.clone(), true);
        }
    });
}

fn stop_core(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    let taken = state.core.lock().unwrap().take();
    if let Some(mut p) = taken {
        p.stop();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Open Gravity", true, None::<&str>)?;
    let browser = MenuItem::with_id(app, "browser", "Open in browser", true, None::<&str>)?;
    let url = MenuItem::with_id(app, "url", "Router: starting…", false, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart router", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Open Gravity", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &browser, &sep1, &url, &restart, &sep2, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Open Gravity")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "browser" => {
                if let Some(u) = app.state::<DesktopState>().url.lock().unwrap().clone() {
                    open_in_browser(&dashboard_url(&u));
                }
            }
            "restart" => {
                stop_core(app);
                boot(app.clone(), true);
            }
            "quit" => {
                app.state::<DesktopState>().quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayItems { url });
    Ok(())
}

// ------------------------------------------------------------------ commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    version: &'static str,
    platform: &'static str,
    phase: Phase,
    message: String,
    url: Option<String>,
    managed: bool,
    close_to_tray: bool,
    autostart: bool,
    embedded_core: bool,
}

#[tauri::command]
fn desktop_info(app: AppHandle, state: State<'_, DesktopState>) -> DesktopInfo {
    use tauri_plugin_autostart::ManagerExt;
    let boot = state.boot.lock().unwrap();
    DesktopInfo {
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        phase: boot.phase.clone(),
        message: boot.message.clone(),
        url: state.url.lock().unwrap().clone(),
        managed: state.core.lock().unwrap().is_some(),
        close_to_tray: state.prefs.lock().unwrap().close_to_tray,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        embedded_core: core::has_payload(),
    }
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Only web links can be opened".into());
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn restart_core(app: AppHandle) {
    stop_core(&app);
    boot(app, true);
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())?;
    launcher.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_close_to_tray(app: AppHandle, state: State<'_, DesktopState>, enabled: bool) {
    let prefs = {
        let mut p = state.prefs.lock().unwrap();
        p.close_to_tray = enabled;
        p.clone()
    };
    save_prefs(&app, &prefs);
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<'_, DesktopState>) {
    state.quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn core_logs(state: State<'_, DesktopState>) -> String {
    core::tail(&state.logs, 400)
}

fn main() {
    let start_hidden = std::env::args().any(|a| a == "--minimized");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(DesktopState {
            core: Mutex::new(None),
            url: Mutex::new(None),
            boot: Mutex::new(Boot { phase: Phase::Starting, message: "Starting…".into() }),
            logs: Arc::new(Mutex::new(Default::default())),
            prefs: Mutex::new(Prefs::default()),
            quitting: AtomicBool::new(false),
            has_window: AtomicBool::new(false),
            booting: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            open_external,
            restart_core,
            set_autostart,
            set_close_to_tray,
            quit_app,
            core_logs
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = app.state::<DesktopState>();
            *state.prefs.lock().unwrap() = load_prefs(&handle);
            // Without a usable webview (e.g. WebView2 missing) keep running from
            // the tray and show the dashboard in the default browser instead.
            let has_window = match create_main_window(&handle, !start_hidden) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("Open Gravity: no native window ({e}); using the browser.");
                    false
                }
            };
            state.has_window.store(has_window, Ordering::SeqCst);
            if let Err(e) = build_tray(&handle) {
                eprintln!("Open Gravity: tray icon unavailable ({e})");
            }
            boot(handle.clone(), true);
            watchdog(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<DesktopState>();
                if !state.quitting.load(Ordering::SeqCst) && state.prefs.lock().unwrap().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    state.quitting.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
            }
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while starting Open Gravity");
    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            // Closing the last window keeps the app in the tray unless quitting.
            let state = app.state::<DesktopState>();
            if code.is_none() && !state.quitting.load(Ordering::SeqCst) && state.has_window.load(Ordering::SeqCst) {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => stop_core(app),
        _ => {}
    });
}
