from __future__ import annotations

import json as json_module
import platform
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


class MaceError(RuntimeError):
    def __init__(self, message: str, exit_code: int = 1) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def json(path: str, input: str | None = None, mace_path: str | None = None, cwd: str | None = None) -> Any:
    output = _run_mace(_json_args(path, input), mace_path=mace_path, cwd=cwd)
    return json_module.loads(output)


def json_text(path: str, input: str | None = None, mace_path: str | None = None, cwd: str | None = None) -> str:
    return _run_mace(_json_args(path, input), mace_path=mace_path, cwd=cwd)


def output(path: str, mace_path: str | None = None, cwd: str | None = None) -> str:
    return _run_mace(["output", path], mace_path=mace_path, cwd=cwd)


def nodes(path: str, mace_path: str | None = None, cwd: str | None = None) -> str:
    return _run_mace(["nodes", path], mace_path=mace_path, cwd=cwd)


def import_json(input_text: str, mace_path: str | None = None, cwd: str | None = None) -> str:
    return _import_text("input.json", input_text, mace_path=mace_path, cwd=cwd)


def import_yaml(input_text: str, mace_path: str | None = None, cwd: str | None = None) -> str:
    return _import_text("input.yaml", input_text, mace_path=mace_path, cwd=cwd)


def import_toml(input_text: str, mace_path: str | None = None, cwd: str | None = None) -> str:
    return _import_text("input.toml", input_text, mace_path=mace_path, cwd=cwd)


def import_file(path: str, mace_path: str | None = None, cwd: str | None = None) -> str:
    with tempfile.TemporaryDirectory(prefix="mace-python-import-") as directory:
        output = _run_mace(["import", path, "--output-dir", directory], mace_path=mace_path, cwd=cwd)
        output_path = next((line for line in output.splitlines() if line.endswith(".mace")), None)
        if output_path is None:
            raise MaceError("import did not report an output file")

        return Path(output_path).read_text(encoding="utf-8")


def _import_text(name: str, input_text: str, mace_path: str | None, cwd: str | None) -> str:
    with tempfile.TemporaryDirectory(prefix="mace-python-") as directory:
        path = Path(directory) / name
        path.write_text(input_text, encoding="utf-8")
        return import_file(str(path), mace_path=mace_path, cwd=cwd)


def _json_args(path: str, input: str | None) -> list[str]:
    args = ["json", path]
    if input is not None:
        args.extend(["--input", input])
    return args


def _bundled_mace_path() -> str | None:
    targets = {
        ("darwin", "x86_64"): "darwin-amd64",
        ("darwin", "arm64"): "darwin-arm64",
        ("linux", "x86_64"): "linux-amd64",
        ("linux", "aarch64"): "linux-arm64",
        ("windows", "AMD64"): "windows-amd64",
        ("windows", "ARM64"): "windows-arm64",
    }
    system = "windows" if sys.platform == "win32" else sys.platform
    target = targets.get((system, platform.machine()))
    if target is None:
        return None

    executable = "mace.exe" if system == "windows" else "mace"
    path = Path(__file__).resolve().parent / "bin" / target / executable
    return str(path) if path.is_file() else None


def _run_mace(args: list[str], mace_path: str | None, cwd: str | None) -> str:
    command = mace_path or _bundled_mace_path() or "mace"
    completed = subprocess.run(
        [command, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise MaceError(completed.stderr.strip() or f"mace exited with code {completed.returncode}", completed.returncode)

    return completed.stdout.strip()
