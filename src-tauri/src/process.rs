use std::ffi::OsStr;
use std::process::Command;

#[cfg(target_os = "windows")]
pub const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    apply_hidden_process_flags(&mut command);
    command
}

pub fn apply_hidden_process_flags(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    #[test]
    fn child_processes_are_created_through_hidden_command_helper() {
        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let offenders = direct_command_new_sites(&src_dir);

        assert!(
            offenders.is_empty(),
            "Use crate::process::hidden_command(...) so Windows GUI builds do not flash console windows:\n{}",
            offenders.join("\n")
        );
    }

    fn direct_command_new_sites(dir: &Path) -> Vec<String> {
        let mut offenders = Vec::new();
        collect_direct_command_new_sites(dir, &mut offenders);
        offenders
    }

    fn collect_direct_command_new_sites(dir: &Path, offenders: &mut Vec<String>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_direct_command_new_sites(&path, offenders);
                continue;
            }
            if path.extension().and_then(|ext| ext.to_str()) != Some("rs")
                || path.file_name().and_then(|name| name.to_str()) == Some("process.rs")
            {
                continue;
            }

            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            for (index, line) in content.lines().enumerate() {
                if line.contains("Command::new(") || line.contains("std::process::Command::new(") {
                    offenders.push(format!(
                        "{}:{}: {}",
                        path.strip_prefix(Path::new(env!("CARGO_MANIFEST_DIR")))
                            .unwrap_or(&path)
                            .display(),
                        index + 1,
                        line.trim()
                    ));
                }
            }
        }
    }
}
