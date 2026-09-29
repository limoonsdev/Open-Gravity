// The router core is the Node.js single executable, embedded gzip-compressed
// in this binary. It is extracted once per version into the app's local data
// folder, started with `--desktop`, and reports its URL on stdout
// ("OG_READY http://127.0.0.1:18080"). If a router is already running on the
// configured port, the desktop app attaches to it instead.
use std::collections::VecDeque;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/core.gz"));
const PAYLOAD_ID: &str = env!("OG_CORE_ID");
const MAX_LOG_LINES: usize = 400;
const START_TIMEOUT: Duration = Duration::from_secs(60);

pub type Logs = Arc<Mutex<VecDeque<String>>>;

pub struct CoreProcess {
    child: Child,
}

impl CoreProcess {
    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub enum Started {
    /// We launched the core and own its lifetime.
    Managed(CoreProcess, String),
    /// Another Open Gravity instance was already serving.
    Attached(String),
}

fn push_log(logs: &Logs, line: String) {
    if let Ok(mut l) = logs.lock() {
        if l.len() >= MAX_LOG_LINES {
            l.pop_front();
        }
        l.push_back(line);
    }
}

pub fn has_payload() -> bool {
    !PAYLOAD.is_empty()
}

fn core_file_name() -> &'static str {
    if cfg!(windows) {
        "open-gravity-core.exe"
    } else {
        "open-gravity-core"
    }
}

/// Data folder of the router (same rules as the core: OPEN_GRAVITY_HOME or ~/.open-gravity).
pub fn router_home() -> PathBuf {
    if let Ok(h) = std::env::var("OPEN_GRAVITY_HOME") {
        if !h.is_empty() {
            return PathBuf::from(h);
        }
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".open-gravity")
}

/// Port from the router's config.json (settings.port), default 18080.
pub fn configured_port() -> u16 {
    let file = router_home().join("config.json");
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("settings")?.get("port")?.as_u64())
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p > 0)
        .unwrap_or(18080)
}

/// True if an Open Gravity router answers /health on this port.
pub fn probe(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let req = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut body = String::new();
    let _ = s.take(64 * 1024).read_to_string(&mut body);
    body.contains("\"service\":\"open-gravity\"")
}

/// Extract the embedded core (once per version) and return its path.
fn extract(base: &Path) -> io::Result<PathBuf> {
    let dir = base.join(PAYLOAD_ID);
    let exe = dir.join(core_file_name());
    if exe.is_file() {
        return Ok(exe);
    }
    fs::create_dir_all(&dir)?;
    let tmp = dir.join(format!("{}.{}.part", core_file_name(), std::process::id()));
    {
        let mut out = fs::File::create(&tmp)?;
        let mut dec = flate2::read::GzDecoder::new(PAYLOAD);
        io::copy(&mut dec, &mut out)?;
        out.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    }
    if let Err(e) = fs::rename(&tmp, &exe) {
        // Another instance may have finished the same extraction first.
        let _ = fs::remove_file(&tmp);
        if !exe.is_file() {
            return Err(e);
        }
    }
    // Best effort: remove cores of older versions.
    if let Ok(entries) = fs::read_dir(base) {
        for e in entries.flatten() {
            if e.file_name() != PAYLOAD_ID && e.path().is_dir() {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(exe)
}

fn core_executable(data_dir: &Path) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("OG_CORE_PATH") {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    if !has_payload() {
        return Err("This build has no embedded router. Set OG_CORE_PATH to an Open Gravity executable, or start the router first.".into());
    }
    extract(&data_dir.join("core")).map_err(|e| format!("Could not prepare the router in {}: {e}", data_dir.display()))
}

/// Start (or attach to) the router. `status` receives progress messages.
pub fn start(data_dir: &Path, logs: &Logs, status: &dyn Fn(&str)) -> Result<Started, String> {
    let port = configured_port();
    if probe(port) {
        push_log(logs, format!("Attached to the router already running on port {port}"));
        return Ok(Started::Attached(format!("http://127.0.0.1:{port}")));
    }
    status("Preparing the router…");
    let exe = core_executable(data_dir)?;
    status("Starting the router…");
    let mut cmd = Command::new(&exe);
    cmd.args(["start", "--desktop", "--no-open", "--parent-pid", &std::process::id().to_string()])
        .env("OG_NO_OPEN", "1")
        .env("OG_NO_PAUSE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not start {}: {e}", exe.display()))?;

    let (tx, rx) = mpsc::channel::<String>();
    if let Some(out) = child.stdout.take() {
        let logs = logs.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Some(url) = line.strip_prefix("OG_READY ") {
                    let _ = tx.send(url.trim().to_string());
                }
                push_log(&logs, strip_ansi(&line));
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let logs = logs.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                push_log(&logs, strip_ansi(&line));
            }
        });
    }

    let t0 = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(150)) {
            Ok(url) => {
                return Ok(match child.try_wait() {
                    // The core found another instance, printed its URL and exited.
                    Ok(Some(_)) => Started::Attached(url),
                    _ => Started::Managed(CoreProcess { child }, url),
                });
            }
            Err(mpsc::RecvTimeoutError::Timeout) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Ok(Some(code)) = child.try_wait() {
                    // Give the reader threads a moment to collect the last lines.
                    std::thread::sleep(Duration::from_millis(150));
                    if let Ok(url) = rx.try_recv() {
                        return Ok(Started::Attached(url));
                    }
                    return Err(format!("The router stopped during startup ({code}).\n{}", tail(logs, 12)));
                }
                if t0.elapsed() > START_TIMEOUT {
                    let _ = child.kill();
                    return Err(format!("The router did not start within {}s.\n{}", START_TIMEOUT.as_secs(), tail(logs, 12)));
                }
            }
        }
    }
}

pub fn tail(logs: &Logs, n: usize) -> String {
    logs.lock()
        .map(|l| l.iter().rev().take(n).rev().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}
