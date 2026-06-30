use rust_i18n::t;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStderr, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::adb::{self, AdbError};

#[derive(Debug, Serialize, Clone, Default)]
pub struct PerformanceSample {
    pub timestamp_ms: u128,
    pub device_serial: String,
    pub target_package: Option<String>,
    pub foreground_package: Option<String>,
    pub foreground_activity: Option<String>,
    pub pid: Option<u32>,
    pub process: ProcessSample,
    pub system: SystemSample,
    pub battery: BatterySample,
    pub thermal: ThermalSample,
    pub display: DisplaySample,
    pub network: NetworkSample,
    pub storage: StorageSample,
    pub gpu: GpuSample,
    pub frame_stats: Option<FrameStatsSample>,
    pub unavailable: Vec<String>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct ProcessSample {
    pub package_name: Option<String>,
    pub pid: Option<u32>,
    pub state: Option<String>,
    pub cpu_jiffies: Option<u64>,
    pub rss_kb: Option<u64>,
    pub pss_kb: Option<u64>,
    pub thread_count: Option<u32>,
    pub running: bool,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct SystemSample {
    pub cpu_total_jiffies: Option<u64>,
    pub cpu_idle_jiffies: Option<u64>,
    pub mem_total_kb: Option<u64>,
    pub mem_available_kb: Option<u64>,
    pub mem_used_kb: Option<u64>,
    pub cpu_frequency: CpuFrequencySample,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct CpuFrequencySample {
    pub average_current_khz: Option<u64>,
    pub average_max_khz: Option<u64>,
    pub online_cores: u32,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct BatterySample {
    pub level_percent: Option<u32>,
    pub status: Option<String>,
    pub temperature_c: Option<f64>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct ThermalSample {
    pub status: Option<i32>,
    pub status_label: Option<String>,
    pub raw: Option<String>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct DisplaySample {
    pub size: Option<String>,
    pub density: Option<String>,
    pub refresh_rate_hz: Option<f64>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct NetworkSample {
    pub rx_bytes: Option<u64>,
    pub tx_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct StorageSample {
    pub data_total_kb: Option<u64>,
    pub data_used_kb: Option<u64>,
    pub data_available_kb: Option<u64>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct GpuSample {
    pub supported: bool,
    pub busy_percent: Option<f64>,
    pub busy_time: Option<u64>,
    pub total_time: Option<u64>,
    pub current_frequency_hz: Option<u64>,
    pub max_frequency_hz: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub process_memory_bytes: Option<u64>,
    pub source: Option<String>,
    pub reason: Option<String>,
    pub raw: Option<String>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct FrameStatsSample {
    pub supported: bool,
    pub frame_count: u32,
    pub fps: Option<f64>,
    pub average_frame_ms: Option<f64>,
    pub p50_frame_ms: Option<f64>,
    pub p95_frame_ms: Option<f64>,
    pub jank_count: u32,
    pub jank_rate: Option<f64>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PerformanceStreamSnapshot {
    pub active: bool,
    pub device_serial: String,
    pub target_package: Option<String>,
    pub follow_foreground: bool,
    pub interval_ms: u64,
    pub started_at_ms: u128,
    pub last_sample: Option<PerformanceSample>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PerformanceStreamConfig {
    device_serial: String,
    target_package: Option<String>,
    follow_foreground: bool,
    interval_ms: u64,
}

struct PerformanceStreamHandle {
    config: PerformanceStreamConfig,
    started_at_ms: u128,
    active: AtomicBool,
    child: Mutex<Option<Child>>,
    latest_sample: Mutex<Option<PerformanceSample>>,
    last_error: Mutex<Option<String>>,
}

#[tauri::command(async)]
pub fn adb_performance_sample(
    app: AppHandle,
    device_serial: String,
    target_package: Option<String>,
    follow_foreground: bool,
    include_slow: bool,
    include_frame_stats: bool,
) -> Result<PerformanceSample, AdbError> {
    let (foreground, foreground_unavailable) = match read_foreground_app(&app, &device_serial) {
        Ok(foreground) => (foreground, None),
        Err(error) => (
            ForegroundApp::default(),
            Some(format!("foreground detection failed: {error}")),
        ),
    };
    let locked_package = target_package
        .as_deref()
        .map(str::trim)
        .filter(|package| is_safe_package_name(package))
        .map(ToString::to_string);
    let target_package = if follow_foreground {
        foreground.package.clone()
    } else {
        locked_package.or_else(|| foreground.package.clone())
    };

    let script = build_stats_script(target_package.as_deref(), include_slow, include_frame_stats);
    let timeout = if include_slow || include_frame_stats {
        Duration::from_secs(10)
    } else {
        Duration::from_secs(5)
    };
    let output = adb::run_adb_with_timeout(
        &app,
        &["shell", script.as_str()],
        Some(&device_serial),
        timeout,
    )?;
    adb::ensure_success(&output, &t!("performance.sample_failed"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut sample =
        parse_performance_sample(now_ms(), device_serial, target_package, foreground, &stdout);
    if let Some(reason) = foreground_unavailable {
        sample.unavailable.push(reason);
    }
    Ok(sample)
}

#[tauri::command(async)]
pub fn adb_performance_stream_start(
    app: AppHandle,
    device_serial: String,
    target_package: Option<String>,
    follow_foreground: bool,
    interval_ms: u64,
) -> Result<PerformanceStreamSnapshot, AdbError> {
    let config = PerformanceStreamConfig {
        device_serial: device_serial.clone(),
        target_package: normalize_optional_package(target_package),
        follow_foreground,
        interval_ms: normalize_stream_interval_ms(interval_ms),
    };

    if let Some(existing) = performance_stream_registry()
        .lock()
        .ok()
        .and_then(|registry| registry.get(&device_serial).cloned())
    {
        if existing.config == config && existing.active.load(Ordering::SeqCst) {
            return Ok(stream_snapshot(&existing));
        }
        stop_performance_stream(&device_serial);
    }

    let script = build_stream_script(
        config.target_package.as_deref(),
        config.follow_foreground,
        config.interval_ms,
    );
    let mut child = adb::spawn_adb_piped(
        &app,
        &["shell", script.as_str()],
        Some(&config.device_serial),
    )?;
    let stdout = child.stdout.take().ok_or_else(|| {
        AdbError::CommandFailed("performance stream stdout unavailable".to_string())
    })?;
    let stderr = child.stderr.take();

    let handle = Arc::new(PerformanceStreamHandle {
        config,
        started_at_ms: now_ms(),
        active: AtomicBool::new(true),
        child: Mutex::new(Some(child)),
        latest_sample: Mutex::new(None),
        last_error: Mutex::new(None),
    });

    if let Ok(mut registry) = performance_stream_registry().lock() {
        registry.insert(device_serial.clone(), handle.clone());
    }

    spawn_stream_stdout_reader(handle.clone(), stdout);
    if let Some(stderr) = stderr {
        spawn_stream_stderr_reader(handle.clone(), stderr);
    }

    Ok(stream_snapshot(&handle))
}

#[tauri::command(async)]
pub fn adb_performance_stream_snapshot(
    device_serial: String,
) -> Result<PerformanceStreamSnapshot, AdbError> {
    let handle = performance_stream_registry()
        .lock()
        .ok()
        .and_then(|registry| registry.get(&device_serial).cloned())
        .ok_or_else(|| AdbError::CommandFailed("performance stream is not active".to_string()))?;
    Ok(stream_snapshot(&handle))
}

#[tauri::command(async)]
pub fn adb_performance_stream_stop(
    device_serial: String,
) -> Result<PerformanceStreamSnapshot, AdbError> {
    Ok(
        stop_performance_stream(&device_serial).unwrap_or_else(|| PerformanceStreamSnapshot {
            active: false,
            device_serial,
            target_package: None,
            follow_foreground: true,
            interval_ms: PERFORMANCE_STREAM_DEFAULT_INTERVAL_MS,
            started_at_ms: 0,
            last_sample: None,
            last_error: None,
        }),
    )
}

const PERFORMANCE_STREAM_DEFAULT_INTERVAL_MS: u64 = 1000;
const PERFORMANCE_STREAM_INTERVALS_MS: [u64; 4] = [500, 1000, 2000, 5000];

fn performance_stream_registry() -> &'static Mutex<HashMap<String, Arc<PerformanceStreamHandle>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<PerformanceStreamHandle>>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn normalize_optional_package(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|package| is_safe_package_name(package))
        .map(ToString::to_string)
}

fn normalize_stream_interval_ms(value: u64) -> u64 {
    if PERFORMANCE_STREAM_INTERVALS_MS.contains(&value) {
        value
    } else {
        PERFORMANCE_STREAM_DEFAULT_INTERVAL_MS
    }
}

fn stream_snapshot(handle: &Arc<PerformanceStreamHandle>) -> PerformanceStreamSnapshot {
    PerformanceStreamSnapshot {
        active: handle.active.load(Ordering::SeqCst),
        device_serial: handle.config.device_serial.clone(),
        target_package: handle.config.target_package.clone(),
        follow_foreground: handle.config.follow_foreground,
        interval_ms: handle.config.interval_ms,
        started_at_ms: handle.started_at_ms,
        last_sample: handle
            .latest_sample
            .lock()
            .ok()
            .and_then(|sample| sample.clone()),
        last_error: handle
            .last_error
            .lock()
            .ok()
            .and_then(|error| error.clone()),
    }
}

fn stop_performance_stream(device_serial: &str) -> Option<PerformanceStreamSnapshot> {
    let handle = performance_stream_registry()
        .lock()
        .ok()
        .and_then(|mut registry| registry.remove(device_serial))?;

    handle.active.store(false, Ordering::SeqCst);
    if let Ok(mut child) = handle.child.lock() {
        if let Some(mut child) = child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    Some(stream_snapshot(&handle))
}

fn spawn_stream_stdout_reader(handle: Arc<PerformanceStreamHandle>, stdout: ChildStdout) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut in_frame = false;
        let mut frame = String::new();

        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    set_stream_error(&handle, format!("performance stream read failed: {error}"));
                    break;
                }
            };

            match line.trim() {
                "__PERF_FRAME_START__" => {
                    in_frame = true;
                    frame.clear();
                }
                "__PERF_FRAME_END__" => {
                    if in_frame {
                        let sample = parse_performance_stream_frame(
                            now_ms(),
                            handle.config.device_serial.clone(),
                            &frame,
                        );
                        if let Ok(mut latest) = handle.latest_sample.lock() {
                            *latest = Some(sample);
                        }
                    }
                    in_frame = false;
                    frame.clear();
                }
                _ if in_frame => {
                    frame.push_str(&line);
                    frame.push('\n');
                }
                _ => {}
            }
        }

        handle.active.store(false, Ordering::SeqCst);
    });
}

fn spawn_stream_stderr_reader(handle: Arc<PerformanceStreamHandle>, stderr: ChildStderr) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                set_stream_error(&handle, trimmed.to_string());
            }
        }
    });
}

fn set_stream_error(handle: &Arc<PerformanceStreamHandle>, message: String) {
    if let Ok(mut error) = handle.last_error.lock() {
        *error = Some(message);
    }
}

fn read_foreground_app(app: &AppHandle, device_serial: &str) -> Result<ForegroundApp, AdbError> {
    let output = adb::run_adb_with_timeout(
        app,
        &[
            "shell",
            "focus=\"$(dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -n 8)\"; echo \"$focus\"; case \"$focus\" in */*) ;; *) dumpsys activity activities 2>/dev/null | grep -E 'topResumedActivity|mResumedActivity|ResumedActivity' | head -n 8 ;; esac; true",
        ],
        Some(device_serial),
        Duration::from_secs(2),
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_foreground_app(&stdout))
}

fn build_stats_script(
    target_package: Option<&str>,
    include_slow: bool,
    include_frame_stats: bool,
) -> String {
    let package = target_package
        .filter(|package| is_safe_package_name(package))
        .unwrap_or("");
    let package_literal = shell_single_quote(package);
    let slow = if include_slow { "1" } else { "0" };
    let frame = if include_frame_stats { "1" } else { "0" };
    let package_assignment = format!("pkg={package_literal}");
    let slow_assignment = format!("include_slow={slow}");
    let frame_assignment = format!("include_frame={frame}");

    build_stats_probe_script(&package_assignment, &slow_assignment, &frame_assignment)
}

fn build_stats_probe_script(
    package_assignment: &str,
    slow_assignment: &str,
    frame_assignment: &str,
) -> String {
    format!(
        r#"{package_assignment}
{slow_assignment}
{frame_assignment}
pid=""
if [ -n "$pkg" ]; then
  pid="$(pidof "$pkg" 2>/dev/null | tr ' ' '\n' | head -n 1)"
fi
echo "__TARGET__"
echo "package=$pkg"
echo "pid=$pid"
echo "__PROC_STAT__"
cat /proc/stat 2>/dev/null | head -n 1
echo "__PID_STAT__"
if [ -n "$pid" ]; then cat "/proc/$pid/stat" 2>/dev/null; fi
echo "__PID_STATUS__"
if [ -n "$pid" ]; then cat "/proc/$pid/status" 2>/dev/null; fi
echo "__MEMINFO__"
cat /proc/meminfo 2>/dev/null
echo "__NET_DEV__"
cat /proc/net/dev 2>/dev/null
echo "__GPU__"
gpu_found=0
for gpu in /sys/class/kgsl/kgsl-3d0 /sys/class/devfreq/*gpu* /sys/class/devfreq/*mali* /sys/class/devfreq/*kgsl* /sys/class/devfreq/*powervr* /sys/class/devfreq/*img* /sys/class/misc/mali0/device /sys/devices/platform/*gpu*/devfreq/* /sys/devices/platform/*mali*/devfreq/* /sys/devices/platform/soc/*gpu*/devfreq/* /sys/devices/platform/soc/*mali*/devfreq/* /sys/devices/platform/soc/*/*gpu*/devfreq/*; do
  if [ -d "$gpu" ]; then
    gpu_found=1
    echo "path=$gpu"
    for file in gpu_busy_percentage busy_percentage utilization gpu_utilization load gpubusy cur_freq max_freq min_freq target_freq trans_stat devfreq/cur_freq devfreq/max_freq; do
      key="$(echo "$file" | tr '/' '_')"
      value="$(cat "$gpu/$file" 2>&1)"
      status="$?"
      value="$(printf "%s" "$value" | head -n 1)"
      if [ "$status" = "0" ] && [ -n "$value" ]; then
        echo "$key=$value"
      elif printf "%s" "$value" | grep -qi "Permission denied"; then
        echo "${{key}}_error=permission denied"
      fi
    done
  fi
done
if [ "$gpu_found" = "0" ]; then
  echo "reason=gpu sysfs counters unavailable"
fi
if [ "$include_slow" = "1" ]; then
  echo "__DUMPSYS_MEMINFO__"
  if [ -n "$pkg" ]; then dumpsys meminfo "$pkg" 2>/dev/null | head -n 120; fi
  echo "__BATTERY__"
  dumpsys battery 2>/dev/null
  echo "__DUMPSYS_GPU__"
  dumpsys gpu 2>/dev/null | head -n 140
  echo "__THERMAL__"
  dumpsys thermalservice 2>/dev/null || dumpsys thermal 2>/dev/null || true
  echo "__CPU_FREQ__"
  for cpu in /sys/devices/system/cpu/cpu[0-9]*; do
    if [ -d "$cpu" ]; then
      name="$(basename "$cpu")"
      cur="$(cat "$cpu/cpufreq/scaling_cur_freq" 2>/dev/null)"
      max="$(cat "$cpu/cpufreq/cpuinfo_max_freq" 2>/dev/null)"
      echo "$name $cur $max"
    fi
  done
  echo "__DF_DATA__"
  df -k /data 2>/dev/null
  echo "__DISPLAY__"
  wm size 2>/dev/null
  wm density 2>/dev/null
  dumpsys display 2>/dev/null | grep -E 'mBaseDisplayInfo|DisplayDeviceInfo|fps|refreshRate' | head -n 25
fi
if [ "$include_frame" = "1" ]; then
  echo "__GFXINFO__"
  if [ -n "$pkg" ]; then dumpsys gfxinfo "$pkg" framestats 2>/dev/null | head -n 260; fi
fi
"#
    )
}

fn build_stream_script(
    target_package: Option<&str>,
    follow_foreground: bool,
    interval_ms: u64,
) -> String {
    let fixed_package = target_package
        .filter(|package| is_safe_package_name(package))
        .unwrap_or("");
    let fixed_package_literal = shell_single_quote(fixed_package);
    let follow = if follow_foreground { "1" } else { "0" };
    let sleep_command = stream_sleep_command(interval_ms);

    format!(
        r#"fixed_pkg={fixed_package_literal}
follow_foreground={follow}
cache_dir="/data/local/tmp/adb-manager-perf-$$"
cache_enabled=1
mkdir -p "$cache_dir" 2>/dev/null || cache_enabled=0
slow_cache="$cache_dir/slow"
frame_cache="$cache_dir/frame"

resolve_target() {{
  focus="$(dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -n 8)"
  case "$focus" in */*) ;; *) focus="$focus
$(dumpsys activity activities 2>/dev/null | grep -E 'topResumedActivity|mResumedActivity|ResumedActivity' | head -n 8)" ;; esac
  foreground_component="$(printf "%s\n" "$focus" | grep -Eo '[A-Za-z0-9_]+([.][A-Za-z0-9_]+)+/[^ }}),;]+' | head -n 1)"
  foreground_pkg="${{foreground_component%%/*}}"
  foreground_activity="${{foreground_component#*/}}"
  if [ "$foreground_component" = "$foreground_activity" ]; then foreground_activity=""; fi
  if [ "$follow_foreground" = "1" ]; then
    pkg="$foreground_pkg"
  else
    pkg="$fixed_pkg"
    if [ -z "$pkg" ]; then pkg="$foreground_pkg"; fi
  fi
  pid=""
  if [ -n "$pkg" ]; then
    pid="$(pidof "$pkg" 2>/dev/null | tr ' ' '\n' | head -n 1)"
  fi
}}

emit_fast_probe() {{
  resolve_target
  echo "__FOREGROUND__"
  echo "$focus"
  echo "package=$foreground_pkg"
  echo "activity=$foreground_activity"
  echo "__TARGET__"
  echo "package=$pkg"
  echo "pid=$pid"
  echo "__PROC_STAT__"
  cat /proc/stat 2>/dev/null | head -n 1
  echo "__PID_STAT__"
  if [ -n "$pid" ]; then cat "/proc/$pid/stat" 2>/dev/null; fi
  echo "__PID_STATUS__"
  if [ -n "$pid" ]; then cat "/proc/$pid/status" 2>/dev/null; fi
  echo "__MEMINFO__"
  cat /proc/meminfo 2>/dev/null
  echo "__NET_DEV__"
  cat /proc/net/dev 2>/dev/null
  echo "__GPU__"
  gpu_found=0
  for gpu in /sys/class/kgsl/kgsl-3d0 /sys/class/devfreq/*gpu* /sys/class/devfreq/*mali* /sys/class/devfreq/*kgsl* /sys/class/devfreq/*powervr* /sys/class/devfreq/*img* /sys/class/misc/mali0/device /sys/devices/platform/*gpu*/devfreq/* /sys/devices/platform/*mali*/devfreq/* /sys/devices/platform/soc/*gpu*/devfreq/* /sys/devices/platform/soc/*mali*/devfreq/* /sys/devices/platform/soc/*/*gpu*/devfreq/*; do
    if [ -d "$gpu" ]; then
      gpu_found=1
      echo "path=$gpu"
      for file in gpu_busy_percentage busy_percentage utilization gpu_utilization load gpubusy cur_freq max_freq min_freq target_freq trans_stat devfreq/cur_freq devfreq/max_freq; do
        key="$(echo "$file" | tr '/' '_')"
        value="$(cat "$gpu/$file" 2>&1)"
        status="$?"
        value="$(printf "%s" "$value" | head -n 1)"
        if [ "$status" = "0" ] && [ -n "$value" ]; then
          echo "$key=$value"
        elif printf "%s" "$value" | grep -qi "Permission denied"; then
          echo "${{key}}_error=permission denied"
        fi
      done
    fi
  done
  if [ "$gpu_found" = "0" ]; then
    echo "reason=gpu sysfs counters unavailable"
  fi
}}

refresh_slow_cache() {{
  while true; do
    if [ "$cache_enabled" != "1" ]; then
      sleep 10
      continue
    fi
    tmp="$slow_cache.tmp"
    {{
      resolve_target
      echo "__DUMPSYS_MEMINFO__"
      if [ -n "$pkg" ]; then dumpsys meminfo "$pkg" 2>/dev/null | head -n 120; fi
      echo "__BATTERY__"
      dumpsys battery 2>/dev/null
      echo "__DUMPSYS_GPU__"
      dumpsys gpu 2>/dev/null | head -n 140
      echo "__THERMAL__"
      dumpsys thermalservice 2>/dev/null || dumpsys thermal 2>/dev/null || true
      echo "__CPU_FREQ__"
      for cpu in /sys/devices/system/cpu/cpu[0-9]*; do
        if [ -d "$cpu" ]; then
          name="$(basename "$cpu")"
          cur="$(cat "$cpu/cpufreq/scaling_cur_freq" 2>/dev/null)"
          max="$(cat "$cpu/cpufreq/cpuinfo_max_freq" 2>/dev/null)"
          echo "$name $cur $max"
        fi
      done
      echo "__DF_DATA__"
      df -k /data 2>/dev/null
      echo "__DISPLAY__"
      wm size 2>/dev/null
      wm density 2>/dev/null
      dumpsys display 2>/dev/null | grep -E 'mBaseDisplayInfo|DisplayDeviceInfo|fps|refreshRate' | head -n 25
    }} > "$tmp"
    mv "$tmp" "$slow_cache" 2>/dev/null || true
    sleep 10
  done
}}

refresh_frame_cache() {{
  while true; do
    if [ "$cache_enabled" != "1" ]; then
      sleep 5
      continue
    fi
    tmp="$frame_cache.tmp"
    {{
      resolve_target
      echo "__GFXINFO__"
      if [ -n "$pkg" ]; then dumpsys gfxinfo "$pkg" framestats 2>/dev/null | head -n 260; fi
    }} > "$tmp"
    mv "$tmp" "$frame_cache" 2>/dev/null || true
    sleep 5
  done
}}

cleanup_perf_stream() {{
  kill "$slow_pid" "$frame_pid" 2>/dev/null || true
  if [ "$cache_enabled" = "1" ]; then
    rm -rf "$cache_dir" 2>/dev/null || true
  fi
}}
trap cleanup_perf_stream EXIT INT TERM
refresh_slow_cache &
slow_pid="$!"
refresh_frame_cache &
frame_pid="$!"

while true; do
  echo "__PERF_FRAME_START__"
  emit_fast_probe
  cat "$slow_cache" 2>/dev/null
  cat "$frame_cache" 2>/dev/null
  echo "__PERF_FRAME_END__"
  {sleep_command}
done
"#
    )
}

fn stream_sleep_command(interval_ms: u64) -> &'static str {
    match normalize_stream_interval_ms(interval_ms) {
        500 => "sleep 0.5 2>/dev/null || usleep 500000 2>/dev/null || toybox usleep 500000 2>/dev/null || sleep 1",
        2000 => "sleep 2",
        5000 => "sleep 5",
        _ => "sleep 1",
    }
}

fn parse_performance_sample(
    timestamp_ms: u128,
    device_serial: String,
    target_package: Option<String>,
    foreground: ForegroundApp,
    stdout: &str,
) -> PerformanceSample {
    let sections = split_sections(stdout);
    let mut unavailable = Vec::new();
    let target = parse_target_section(section(&sections, "TARGET"));
    let target_package = target_package.or(target.package.clone());
    let pid = target.pid;
    let process = ProcessSample {
        package_name: target_package.clone(),
        pid,
        state: parse_process_state(section(&sections, "PID_STATUS"))
            .or_else(|| parse_proc_stat_state(section(&sections, "PID_STAT"))),
        cpu_jiffies: parse_process_cpu_jiffies(section(&sections, "PID_STAT")),
        rss_kb: parse_status_value_kb(section(&sections, "PID_STATUS"), "VmRSS")
            .or_else(|| parse_proc_stat_rss_kb(section(&sections, "PID_STAT"))),
        pss_kb: parse_meminfo_pss(section(&sections, "DUMPSYS_MEMINFO")),
        thread_count: parse_status_value_u32(section(&sections, "PID_STATUS"), "Threads"),
        running: pid.is_some(),
    };
    if target_package.is_some() && pid.is_none() {
        unavailable.push("target process not running".to_string());
    }

    let system_mem = parse_system_meminfo(section(&sections, "MEMINFO"));
    let mut gpu = parse_gpu(section(&sections, "GPU"));
    enrich_gpu_from_dumpsys(&mut gpu, section(&sections, "DUMPSYS_GPU"), pid);
    if !gpu.supported {
        unavailable.push(
            gpu.reason
                .clone()
                .unwrap_or_else(|| "gpu counters unavailable".to_string()),
        );
    }
    let system = SystemSample {
        cpu_total_jiffies: parse_proc_stat_cpu(section(&sections, "PROC_STAT"))
            .map(|value| value.0),
        cpu_idle_jiffies: parse_proc_stat_cpu(section(&sections, "PROC_STAT")).map(|value| value.1),
        mem_total_kb: system_mem.mem_total_kb,
        mem_available_kb: system_mem.mem_available_kb,
        mem_used_kb: system_mem.mem_used_kb,
        cpu_frequency: parse_cpu_frequency(section(&sections, "CPU_FREQ")),
    };
    let frame_stats = if sections.contains_key("GFXINFO") {
        let parsed = parse_gfxinfo_framestats(section(&sections, "GFXINFO"));
        if !parsed.supported {
            unavailable.push(
                parsed
                    .reason
                    .clone()
                    .unwrap_or_else(|| "gfxinfo framestats unavailable".to_string()),
            );
        }
        Some(parsed)
    } else {
        None
    };

    PerformanceSample {
        timestamp_ms,
        device_serial,
        target_package,
        foreground_package: foreground.package,
        foreground_activity: foreground.activity,
        pid,
        process,
        system,
        battery: parse_battery(section(&sections, "BATTERY")),
        thermal: parse_thermal(section(&sections, "THERMAL")),
        display: parse_display(section(&sections, "DISPLAY")),
        network: parse_network_dev(section(&sections, "NET_DEV")),
        storage: parse_storage(section(&sections, "DF_DATA")),
        gpu,
        frame_stats,
        unavailable,
    }
}

fn parse_performance_stream_frame(
    timestamp_ms: u128,
    device_serial: String,
    stdout: &str,
) -> PerformanceSample {
    let sections = split_sections(stdout);
    let foreground = parse_foreground_app(section(&sections, "FOREGROUND"));
    let target = parse_target_section(section(&sections, "TARGET"));
    let target_package = target.package.or_else(|| foreground.package.clone());
    parse_performance_sample(
        timestamp_ms,
        device_serial,
        target_package,
        foreground,
        stdout,
    )
}

#[derive(Debug, Clone, Default)]
struct ForegroundApp {
    package: Option<String>,
    activity: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct TargetSection {
    package: Option<String>,
    pid: Option<u32>,
}

#[derive(Debug, Clone, Default)]
struct SystemMemInfo {
    mem_total_kb: Option<u64>,
    mem_available_kb: Option<u64>,
    mem_used_kb: Option<u64>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn is_safe_package_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.contains('.')
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.'))
}

fn split_sections(stdout: &str) -> HashMap<String, String> {
    let mut sections = HashMap::new();
    let mut current: Option<String> = None;
    let mut lines = Vec::new();

    for line in stdout.lines() {
        if line.starts_with("__") && line.ends_with("__") && line.len() > 4 {
            if let Some(name) = current.take() {
                sections.insert(name, lines.join("\n"));
                lines.clear();
            }
            current = Some(line.trim_matches('_').to_string());
        } else if current.is_some() {
            lines.push(line.to_string());
        }
    }

    if let Some(name) = current {
        sections.insert(name, lines.join("\n"));
    }
    sections
}

fn section<'a>(sections: &'a HashMap<String, String>, name: &str) -> &'a str {
    sections.get(name).map(String::as_str).unwrap_or("")
}

fn parse_foreground_app(output: &str) -> ForegroundApp {
    let explicit_package = output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("package=")
            .map(str::trim)
            .filter(|package| is_safe_package_name(package))
            .map(ToString::to_string)
    });
    if explicit_package.is_some() {
        let explicit_activity = output.lines().find_map(|line| {
            line.trim()
                .strip_prefix("activity=")
                .map(str::trim)
                .filter(|activity| !activity.is_empty())
                .map(ToString::to_string)
        });
        return ForegroundApp {
            package: explicit_package,
            activity: explicit_activity,
        };
    }

    for raw_token in output.split_whitespace() {
        let token = raw_token
            .trim_matches(|ch: char| matches!(ch, '{' | '}' | '[' | ']' | ')' | '(' | ',' | ';'));
        let Some((package, activity)) = token.split_once('/') else {
            continue;
        };
        if is_safe_package_name(package) {
            return ForegroundApp {
                package: Some(package.to_string()),
                activity: Some(activity.trim_matches('}').to_string()),
            };
        }
    }
    ForegroundApp::default()
}

fn parse_target_section(section: &str) -> TargetSection {
    let mut target = TargetSection::default();
    for line in section.lines() {
        if let Some(value) = line.strip_prefix("package=") {
            let package = value.trim();
            if is_safe_package_name(package) {
                target.package = Some(package.to_string());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("pid=") {
            target.pid = value.trim().parse::<u32>().ok();
        }
    }
    target
}

fn parse_proc_stat_cpu(section: &str) -> Option<(u64, u64)> {
    let line = section.lines().find(|line| line.starts_with("cpu "))?;
    let values = line
        .split_whitespace()
        .skip(1)
        .filter_map(|item| item.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if values.len() < 4 {
        return None;
    }
    let total = values.iter().copied().sum();
    let idle = values.get(3).copied().unwrap_or(0) + values.get(4).copied().unwrap_or(0);
    Some((total, idle))
}

fn parse_process_cpu_jiffies(section: &str) -> Option<u64> {
    let (_, fields) = split_proc_stat(section)?;
    let utime = fields.get(11)?.parse::<u64>().ok()?;
    let stime = fields.get(12)?.parse::<u64>().ok()?;
    Some(utime + stime)
}

fn parse_proc_stat_state(section: &str) -> Option<String> {
    let (_, fields) = split_proc_stat(section)?;
    fields.first().map(|value| (*value).to_string())
}

fn parse_proc_stat_rss_kb(section: &str) -> Option<u64> {
    let (_, fields) = split_proc_stat(section)?;
    let rss_pages = fields.get(21)?.parse::<i64>().ok()?;
    if rss_pages < 0 {
        return None;
    }
    Some(rss_pages as u64 * 4)
}

fn split_proc_stat(section: &str) -> Option<(String, Vec<&str>)> {
    let line = section.lines().find(|line| !line.trim().is_empty())?;
    let open = line.find('(')?;
    let close = line.rfind(')')?;
    if close <= open {
        return None;
    }
    let comm = line[open + 1..close].to_string();
    let fields = line[close + 1..].split_whitespace().collect::<Vec<_>>();
    Some((comm, fields))
}

fn parse_process_state(section: &str) -> Option<String> {
    parse_status_text(section, "State").map(|value| value.to_string())
}

fn parse_status_value_kb(section: &str, key: &str) -> Option<u64> {
    parse_status_text(section, key).and_then(first_number_u64)
}

fn parse_status_value_u32(section: &str, key: &str) -> Option<u32> {
    parse_status_text(section, key).and_then(|value| first_number_u64(value).map(|v| v as u32))
}

fn parse_status_text<'a>(section: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key}:");
    section
        .lines()
        .find_map(|line| line.trim().strip_prefix(&prefix).map(str::trim))
}

fn first_number_u64(value: &str) -> Option<u64> {
    value
        .split(|ch: char| !ch.is_ascii_digit())
        .find(|item| !item.is_empty())
        .and_then(|item| item.parse::<u64>().ok())
}

fn first_number_f64(value: &str) -> Option<f64> {
    value
        .split(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
        .find(|item| !item.is_empty())
        .and_then(|item| item.parse::<f64>().ok())
        .filter(|item| item.is_finite())
}

fn parse_system_meminfo(section: &str) -> SystemMemInfo {
    let total = parse_meminfo_value(section, "MemTotal");
    let available = parse_meminfo_value(section, "MemAvailable")
        .or_else(|| parse_meminfo_value(section, "MemFree"));
    let used = total
        .zip(available)
        .map(|(total, available)| total.saturating_sub(available));
    SystemMemInfo {
        mem_total_kb: total,
        mem_available_kb: available,
        mem_used_kb: used,
    }
}

fn parse_meminfo_value(section: &str, key: &str) -> Option<u64> {
    parse_status_text(section, key).and_then(first_number_u64)
}

fn parse_meminfo_pss(section: &str) -> Option<u64> {
    for line in section.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("TOTAL PSS:") {
            return first_number_u64(value);
        }
        if trimmed.starts_with("TOTAL ") {
            let values = trimmed
                .split_whitespace()
                .skip(1)
                .filter_map(|item| item.parse::<u64>().ok())
                .collect::<Vec<_>>();
            if let Some(pss) = values.first() {
                return Some(*pss);
            }
        }
    }
    None
}

fn parse_network_dev(section: &str) -> NetworkSample {
    let mut rx = 0u64;
    let mut tx = 0u64;
    let mut found = false;
    for line in section.lines() {
        let Some((iface, values)) = line.split_once(':') else {
            continue;
        };
        if iface.trim() == "lo" {
            continue;
        }
        let numbers = values
            .split_whitespace()
            .filter_map(|item| item.parse::<u64>().ok())
            .collect::<Vec<_>>();
        if numbers.len() >= 16 {
            rx = rx.saturating_add(numbers[0]);
            tx = tx.saturating_add(numbers[8]);
            found = true;
        }
    }
    NetworkSample {
        rx_bytes: found.then_some(rx),
        tx_bytes: found.then_some(tx),
    }
}

fn parse_battery(section: &str) -> BatterySample {
    let level = parse_colon_u32(section, "level");
    let status = parse_colon_text(section, "status").map(android_battery_status);
    let temperature_c = parse_colon_u32(section, "temperature").map(|value| value as f64 / 10.0);
    BatterySample {
        level_percent: level,
        status,
        temperature_c,
    }
}

fn android_battery_status(value: &str) -> String {
    match value.trim() {
        "1" => "unknown",
        "2" => "charging",
        "3" => "discharging",
        "4" => "not charging",
        "5" => "full",
        other => other,
    }
    .to_string()
}

fn parse_colon_u32(section: &str, key: &str) -> Option<u32> {
    parse_colon_text(section, key).and_then(|value| first_number_u64(value).map(|v| v as u32))
}

fn parse_colon_text<'a>(section: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key}:");
    section
        .lines()
        .find_map(|line| line.trim().strip_prefix(&prefix).map(str::trim))
}

fn parse_thermal(section: &str) -> ThermalSample {
    let status = section.lines().find_map(|line| {
        let trimmed = line.trim();
        for prefix in ["mStatus=", "Status:", "status="] {
            if let Some(value) = trimmed.strip_prefix(prefix) {
                return first_signed_i32(value);
            }
        }
        None
    });
    ThermalSample {
        status,
        status_label: status.map(thermal_status_label),
        raw: (!section.trim().is_empty())
            .then(|| section.lines().take(6).collect::<Vec<_>>().join("\n")),
    }
}

fn first_signed_i32(value: &str) -> Option<i32> {
    value
        .split(|ch: char| !(ch.is_ascii_digit() || ch == '-'))
        .find(|item| !item.is_empty() && *item != "-")
        .and_then(|item| item.parse::<i32>().ok())
}

fn thermal_status_label(status: i32) -> String {
    match status {
        0 => "none",
        1 => "light",
        2 => "moderate",
        3 => "severe",
        4 => "critical",
        5 => "emergency",
        6 => "shutdown",
        _ => "unknown",
    }
    .to_string()
}

fn parse_cpu_frequency(section: &str) -> CpuFrequencySample {
    let mut current_sum = 0u64;
    let mut current_count = 0u64;
    let mut max_sum = 0u64;
    let mut max_count = 0u64;
    let mut cores = 0u32;
    for line in section.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.first().is_some_and(|name| name.starts_with("cpu")) {
            cores += 1;
            if let Some(value) = parts.get(1).and_then(|value| value.parse::<u64>().ok()) {
                current_sum = current_sum.saturating_add(value);
                current_count += 1;
            }
            if let Some(value) = parts.get(2).and_then(|value| value.parse::<u64>().ok()) {
                max_sum = max_sum.saturating_add(value);
                max_count += 1;
            }
        }
    }
    CpuFrequencySample {
        average_current_khz: (current_count > 0).then(|| current_sum / current_count),
        average_max_khz: (max_count > 0).then(|| max_sum / max_count),
        online_cores: cores,
    }
}

fn parse_storage(section: &str) -> StorageSample {
    let Some(line) = section.lines().skip(1).find(|line| line.contains("/data")) else {
        return StorageSample::default();
    };
    let parts = line.split_whitespace().collect::<Vec<_>>();
    StorageSample {
        data_total_kb: parts.get(1).and_then(|value| value.parse::<u64>().ok()),
        data_used_kb: parts.get(2).and_then(|value| value.parse::<u64>().ok()),
        data_available_kb: parts.get(3).and_then(|value| value.parse::<u64>().ok()),
    }
}

fn parse_gpu(section: &str) -> GpuSample {
    let mut sample = GpuSample::default();
    let mut raw_lines = Vec::new();
    let mut permission_denied = false;
    for line in section.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        raw_lines.push(trimmed.to_string());
        if let Some(value) = trimmed.strip_prefix("path=") {
            if sample.source.is_none() {
                sample.source = Some(value.to_string());
            }
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("reason=") {
            sample.reason = Some(value.to_string());
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            if key.ends_with("_error") {
                if value.to_ascii_lowercase().contains("permission denied") {
                    permission_denied = true;
                }
                continue;
            }
            match key {
                "gpu_busy_percentage" | "busy_percentage" | "utilization" | "load" => {
                    sample.busy_percent = sample.busy_percent.or_else(|| {
                        first_number_f64(value).map(|percent| percent.clamp(0.0, 100.0))
                    });
                }
                "gpubusy" => {
                    let numbers = value
                        .split_whitespace()
                        .filter_map(|item| item.parse::<u64>().ok())
                        .collect::<Vec<_>>();
                    if numbers.len() >= 2 {
                        sample.busy_time = sample.busy_time.or(Some(numbers[0]));
                        sample.total_time = sample.total_time.or(Some(numbers[1]));
                    }
                }
                "cur_freq" | "devfreq_cur_freq" => {
                    sample.current_frequency_hz = sample
                        .current_frequency_hz
                        .or_else(|| first_number_u64(value));
                }
                "max_freq" | "devfreq_max_freq" => {
                    sample.max_frequency_hz =
                        sample.max_frequency_hz.or_else(|| first_number_u64(value));
                }
                "memory_total_bytes" => {
                    sample.memory_total_bytes = sample
                        .memory_total_bytes
                        .or_else(|| first_number_u64(value));
                }
                "process_memory_bytes" => {
                    sample.process_memory_bytes = sample
                        .process_memory_bytes
                        .or_else(|| first_number_u64(value));
                }
                _ => {}
            }
        }
    }

    sample.supported = sample.busy_percent.is_some()
        || sample.busy_time.is_some()
        || sample.total_time.is_some()
        || sample.current_frequency_hz.is_some()
        || sample.max_frequency_hz.is_some()
        || sample.memory_total_bytes.is_some()
        || sample.process_memory_bytes.is_some();
    if permission_denied && sample.reason.is_none() {
        sample.reason = Some("gpu counters permission denied by device".to_string());
    }
    if !sample.supported && sample.reason.is_none() {
        sample.reason = Some("gpu sysfs counters unavailable".to_string());
    }
    sample.raw = (!raw_lines.is_empty()).then(|| {
        raw_lines
            .into_iter()
            .take(16)
            .collect::<Vec<_>>()
            .join("\n")
    });
    sample
}

fn enrich_gpu_from_dumpsys(sample: &mut GpuSample, section: &str, target_pid: Option<u32>) {
    if section.trim().is_empty() {
        return;
    }

    let (total, process) = parse_dumpsys_gpu_memory(section, target_pid);
    sample.memory_total_bytes = sample.memory_total_bytes.or(total);
    sample.process_memory_bytes = sample.process_memory_bytes.or(process);
    if sample.memory_total_bytes.is_some() || sample.process_memory_bytes.is_some() {
        sample.supported = true;
        if !has_gpu_counter_values(sample) {
            sample.source = Some("dumpsys gpu".to_string());
        } else if sample.source.is_none() {
            sample.source = Some("dumpsys gpu".to_string());
        }
    }
}

fn has_gpu_counter_values(sample: &GpuSample) -> bool {
    sample.busy_percent.is_some()
        || sample.busy_time.is_some()
        || sample.total_time.is_some()
        || sample.current_frequency_hz.is_some()
        || sample.max_frequency_hz.is_some()
}

fn parse_dumpsys_gpu_memory(section: &str, target_pid: Option<u32>) -> (Option<u64>, Option<u64>) {
    let mut total = None;
    let mut process = None;
    for line in section.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("Global total:") {
            total = total.or_else(|| first_number_u64(value));
            continue;
        }
        let parts = trimmed.split_whitespace().collect::<Vec<_>>();
        if parts.len() >= 4
            && parts[0] == "Proc"
            && parts[2] == "total:"
            && target_pid.is_some_and(|pid| parts[1].parse::<u32>().ok() == Some(pid))
        {
            process = process.or_else(|| parts[3].parse::<u64>().ok());
        }
    }
    (total, process)
}

fn parse_display(section: &str) -> DisplaySample {
    let size = section
        .lines()
        .find_map(|line| line.trim().strip_prefix("Physical size:").map(str::trim))
        .or_else(|| {
            section
                .lines()
                .find_map(|line| line.trim().strip_prefix("Override size:").map(str::trim))
        })
        .map(ToString::to_string);
    let density = section
        .lines()
        .find_map(|line| line.trim().strip_prefix("Physical density:").map(str::trim))
        .or_else(|| {
            section
                .lines()
                .find_map(|line| line.trim().strip_prefix("Override density:").map(str::trim))
        })
        .map(ToString::to_string);
    let refresh_rate_hz = section.lines().find_map(parse_refresh_rate);
    DisplaySample {
        size,
        density,
        refresh_rate_hz,
    }
}

fn parse_refresh_rate(line: &str) -> Option<f64> {
    for key in ["fps=", "refreshRate ", "refreshRate=", "modeRefreshRate="] {
        if let Some(start) = line.find(key) {
            let rest = &line[start + key.len()..];
            return rest
                .split(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
                .find(|item| !item.is_empty())
                .and_then(|item| item.parse::<f64>().ok());
        }
    }
    None
}

fn parse_gfxinfo_framestats(section: &str) -> FrameStatsSample {
    let mut header: Option<Vec<&str>> = None;
    let mut durations = Vec::new();
    let mut first_completed = None;
    let mut last_completed = None;

    for line in section.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Flags,") {
            header = Some(trimmed.split(',').collect());
            continue;
        }
        let Some(header) = header.as_ref() else {
            continue;
        };
        if !trimmed.contains(',') {
            continue;
        }
        let values = trimmed.split(',').collect::<Vec<_>>();
        if values.len() < header.len() {
            continue;
        }
        let intended = value_for_header(header, &values, "IntendedVsync");
        let completed = value_for_header(header, &values, "FrameCompleted");
        if let (Some(intended), Some(completed)) = (intended, completed) {
            if completed > intended {
                let duration_ms = (completed - intended) as f64 / 1_000_000.0;
                if duration_ms.is_finite() && duration_ms > 0.0 && duration_ms < 1000.0 {
                    durations.push(duration_ms);
                    first_completed = first_completed.or(Some(completed));
                    last_completed = Some(completed);
                }
            }
        }
    }

    if durations.is_empty() {
        return FrameStatsSample {
            supported: false,
            reason: Some("gfxinfo framestats unavailable for this package".to_string()),
            ..FrameStatsSample::default()
        };
    }

    durations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let frame_count = durations.len() as u32;
    let total_ms = durations.iter().sum::<f64>();
    let average = total_ms / frame_count as f64;
    let p50 = percentile(&durations, 0.50);
    let p95 = percentile(&durations, 0.95);
    let jank_count = durations.iter().filter(|value| **value > 16.67).count() as u32;
    let fps = first_completed
        .zip(last_completed)
        .and_then(|(first, last)| {
            let seconds = (last.saturating_sub(first)) as f64 / 1_000_000_000.0;
            (seconds > 0.0).then_some(frame_count as f64 / seconds)
        });

    FrameStatsSample {
        supported: true,
        frame_count,
        fps,
        average_frame_ms: Some(average),
        p50_frame_ms: Some(p50),
        p95_frame_ms: Some(p95),
        jank_count,
        jank_rate: Some(jank_count as f64 / frame_count as f64 * 100.0),
        reason: None,
    }
}

fn value_for_header(header: &[&str], values: &[&str], name: &str) -> Option<u64> {
    let index = header.iter().position(|item| item.trim() == name)?;
    values.get(index)?.trim().parse::<u64>().ok()
}

fn percentile(sorted: &[f64], percentile: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f64 * percentile).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_foreground_package_from_window_focus() {
        let parsed =
            parse_foreground_app("mCurrentFocus=Window{37d u0 com.example.game/.MainActivity}");

        assert_eq!(parsed.package.as_deref(), Some("com.example.game"));
        assert_eq!(parsed.activity.as_deref(), Some(".MainActivity"));
    }

    #[test]
    fn parses_foreground_package_from_cozyla_window_focus() {
        let parsed = parse_foreground_app(
            "mCurrentFocus=Window{b06474e u0 com.cozyla.calendar/com.cozyla.calendar.ui.home.HomeActivity}, [type=1]",
        );

        assert_eq!(parsed.package.as_deref(), Some("com.cozyla.calendar"));
        assert_eq!(
            parsed.activity.as_deref(),
            Some("com.cozyla.calendar.ui.home.HomeActivity")
        );
    }

    #[test]
    fn parses_foreground_package_from_activity_resume() {
        let parsed = parse_foreground_app(
            "topResumedActivity=ActivityRecord{aea5708 u0 com.cozyla.calendar/.ui.home.HomeActivity t385 d0}",
        );

        assert_eq!(parsed.package.as_deref(), Some("com.cozyla.calendar"));
        assert_eq!(parsed.activity.as_deref(), Some(".ui.home.HomeActivity"));
    }

    #[test]
    fn parses_proc_stat_cpu_totals() {
        let parsed = parse_proc_stat_cpu("cpu  100 20 30 400 50 0 0 0 0 0").unwrap();

        assert_eq!(parsed.0, 600);
        assert_eq!(parsed.1, 450);
    }

    #[test]
    fn parses_process_status_values() {
        let status = "Name:\tgame\nState:\tR (running)\nVmRSS:\t 123456 kB\nThreads:\t31";

        assert_eq!(parse_process_state(status).as_deref(), Some("R (running)"));
        assert_eq!(parse_status_value_kb(status, "VmRSS"), Some(123456));
        assert_eq!(parse_status_value_u32(status, "Threads"), Some(31));
    }

    #[test]
    fn parses_system_meminfo() {
        let parsed = parse_system_meminfo("MemTotal: 1000 kB\nMemAvailable: 250 kB\n");

        assert_eq!(parsed.mem_total_kb, Some(1000));
        assert_eq!(parsed.mem_available_kb, Some(250));
        assert_eq!(parsed.mem_used_kb, Some(750));
    }

    #[test]
    fn parses_system_metrics_without_foreground_target() {
        let stdout = "\
__TARGET__
package=
pid=
__PROC_STAT__
cpu  100 20 30 400 50 0 0 0 0 0
__MEMINFO__
MemTotal: 1000 kB
MemAvailable: 250 kB
__NET_DEV__
wlan0: 1024 1 0 0 0 0 0 0 2048 1 0 0 0 0 0 0
";
        let parsed = parse_performance_sample(
            42,
            "USB123".to_string(),
            None,
            ForegroundApp::default(),
            stdout,
        );

        assert_eq!(parsed.pid, None);
        assert_eq!(parsed.system.cpu_total_jiffies, Some(600));
        assert_eq!(parsed.system.mem_used_kb, Some(750));
        assert_eq!(parsed.network.rx_bytes, Some(1024));
        assert_eq!(parsed.network.tx_bytes, Some(2048));
    }

    #[test]
    fn parses_stream_frame_with_explicit_foreground_package() {
        let stdout = "\
__FOREGROUND__
package=com.example.app
activity=.MainActivity
__TARGET__
package=com.example.app
pid=123
__PROC_STAT__
cpu  100 20 30 400 50 0 0 0 0 0
__PID_STAT__
123 (example) S 0 0 0 0 0 0 0 0 0 10 5 0 0 0 0 0 0 0 0 0 0 25
__PID_STATUS__
State:\tS (sleeping)
VmRSS:\t 4096 kB
Threads:\t12
__MEMINFO__
MemTotal: 2000 kB
MemAvailable: 500 kB
__NET_DEV__
wlan0: 100 1 0 0 0 0 0 0 300 1 0 0 0 0 0 0
";
        let parsed = parse_performance_stream_frame(42, "USB123".to_string(), stdout);

        assert_eq!(
            parsed.foreground_package.as_deref(),
            Some("com.example.app")
        );
        assert_eq!(parsed.foreground_activity.as_deref(), Some(".MainActivity"));
        assert_eq!(parsed.target_package.as_deref(), Some("com.example.app"));
        assert_eq!(parsed.pid, Some(123));
        assert_eq!(parsed.process.thread_count, Some(12));
    }

    #[test]
    fn builds_stream_script_with_frame_markers_and_fractional_sleep() {
        let script = build_stream_script(Some("com.example.app"), true, 500);

        assert!(script.contains("__PERF_FRAME_START__"));
        assert!(script.contains("__PERF_FRAME_END__"));
        assert!(script.contains("refresh_slow_cache &"));
        assert!(script.contains("refresh_frame_cache &"));
        assert!(script.contains("cat \"$slow_cache\""));
        assert!(script.contains("sleep 0.5"));
        assert!(script.contains("usleep 500000"));
        assert!(script.contains("follow_foreground=1"));
        assert!(script.contains("fixed_pkg='com.example.app'"));
    }

    #[test]
    fn parses_battery_temperature_as_celsius() {
        let parsed = parse_battery("level: 88\nstatus: 2\ntemperature: 436\n");

        assert_eq!(parsed.level_percent, Some(88));
        assert_eq!(parsed.status.as_deref(), Some("charging"));
        assert_eq!(parsed.temperature_c, Some(43.6));
    }

    #[test]
    fn parses_thermal_status() {
        let parsed = parse_thermal("mStatus=2\n");

        assert_eq!(parsed.status, Some(2));
        assert_eq!(parsed.status_label.as_deref(), Some("moderate"));
    }

    #[test]
    fn parses_gfxinfo_framestats() {
        let stats = "\
Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted
0,1000000000,0,0,0,0,0,0,0,0,0,0,0,1010000000,0,0,0
0,1030000000,0,0,0,0,0,0,0,0,0,0,0,1055000000,0,0,0";
        let parsed = parse_gfxinfo_framestats(stats);

        assert!(parsed.supported);
        assert_eq!(parsed.frame_count, 2);
        assert_eq!(parsed.jank_count, 1);
        assert_eq!(parsed.p95_frame_ms, Some(25.0));
    }

    #[test]
    fn parses_gpu_sysfs_metrics() {
        let parsed = parse_gpu(
            "path=/sys/class/kgsl/kgsl-3d0\ngpubusy=25 100\ncur_freq=500000000\nmax_freq=800000000\n",
        );

        assert!(parsed.supported);
        assert_eq!(parsed.busy_time, Some(25));
        assert_eq!(parsed.total_time, Some(100));
        assert_eq!(parsed.current_frequency_hz, Some(500000000));
        assert_eq!(parsed.max_frequency_hz, Some(800000000));
        assert_eq!(parsed.source.as_deref(), Some("/sys/class/kgsl/kgsl-3d0"));
    }

    #[test]
    fn parses_gpu_direct_busy_percentage() {
        let parsed = parse_gpu("path=/sys/class/devfreq/gpu\nload=42@600000000Hz\n");

        assert!(parsed.supported);
        assert_eq!(parsed.busy_percent, Some(42.0));
    }

    #[test]
    fn marks_gpu_permission_denied_separately_from_missing_counters() {
        let parsed = parse_gpu(
            "path=/sys/class/devfreq/23100000.gpu\ncur_freq_error=permission denied\nmax_freq_error=permission denied\n",
        );

        assert!(!parsed.supported);
        assert_eq!(
            parsed.reason.as_deref(),
            Some("gpu counters permission denied by device")
        );
        assert_eq!(
            parsed.source.as_deref(),
            Some("/sys/class/devfreq/23100000.gpu")
        );
    }

    #[test]
    fn enriches_gpu_memory_from_dumpsys_gpu() {
        let mut sample =
            parse_gpu("path=/sys/class/devfreq/23100000.gpu\ncur_freq_error=permission denied\n");
        enrich_gpu_from_dumpsys(
            &mut sample,
            "Memory snapshot for GPU 0:\nGlobal total: 414253056\nProc 7903 total: 172662784\nProc 42 total: 2048\n",
            Some(7903),
        );

        assert!(sample.supported);
        assert_eq!(sample.memory_total_bytes, Some(414253056));
        assert_eq!(sample.process_memory_bytes, Some(172662784));
        assert_eq!(sample.source.as_deref(), Some("dumpsys gpu"));
        assert_eq!(
            sample.reason.as_deref(),
            Some("gpu counters permission denied by device")
        );
    }
}
