from __future__ import annotations

import json as json_module
import platform
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias, cast

type MaceValue = str | int | float | bool | list[MaceValue] | MaceRecord
MaceRecord: TypeAlias = dict[str, MaceValue]


@dataclass(frozen=True)
class MacePosition:
    line: int
    column: int


@dataclass(frozen=True)
class MaceSourceRange:
    start: MacePosition


@dataclass(frozen=True)
class MaceDiagnostic:
    message: str
    category: str | None = None
    code: str | None = None
    range: MaceSourceRange | None = None
    path: str | None = None


class MaceError(RuntimeError):
    def __init__(self, message: str, exit_code: int = 1, diagnostic: MaceDiagnostic | None = None) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.diagnostic = diagnostic or _diagnostic_from_message(message)


def json(path: str, input: str | None = None, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    output = _run_mace(_json_args(path, input), mace_path=mace_path, cwd=cwd)
    return _transform_json_output(output)


def transform(source: str, input: str | None = None, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    with tempfile.TemporaryDirectory(prefix="mace-python-source-") as directory:
        path = Path(directory) / "source.mace"
        path.write_text(source, encoding="utf-8")
        return json(str(path), input=input, mace_path=mace_path, cwd=cwd)


def json_text(path: str, input: str | None = None, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    return json(path, input=input, mace_path=mace_path, cwd=cwd)


def output(path: str, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    return json(path, mace_path=mace_path, cwd=cwd)


def import_json(input_text: str, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    return _import_text("input.json", input_text, mace_path=mace_path, cwd=cwd)


def import_yaml(input_text: str, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    return _import_text("input.yaml", input_text, mace_path=mace_path, cwd=cwd)


def import_toml(input_text: str, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    return _import_text("input.toml", input_text, mace_path=mace_path, cwd=cwd)


def import_file(path: str, mace_path: str | None = None, cwd: str | None = None) -> MaceRecord:
    with tempfile.TemporaryDirectory(prefix="mace-python-import-") as directory:
        output = _run_mace(["import", path, "--output-dir", directory], mace_path=mace_path, cwd=cwd)
        output_path = next((line for line in output.splitlines() if line.endswith(".mace")), None)
        if output_path is None:
            raise MaceError("import did not report an output file")

        source = Path(output_path).read_text(encoding="utf-8")
        return transform(source, mace_path=mace_path, cwd=cwd)


def _import_text(name: str, input_text: str, mace_path: str | None, cwd: str | None) -> MaceRecord:
    with tempfile.TemporaryDirectory(prefix="mace-python-") as directory:
        path = Path(directory) / name
        path.write_text(input_text, encoding="utf-8")
        return import_file(str(path), mace_path=mace_path, cwd=cwd)



def _transform_json_output(output: str) -> MaceRecord:
    return cast(MaceRecord, json_module.loads(output))


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
        message = completed.stderr.strip() or f"mace exited with code {completed.returncode}"
        raise MaceError(message, completed.returncode, _diagnostic_from_message(message, _source_path_from_args(args)))

    return completed.stdout.strip()


def _diagnostic_from_message(message: str, path: str | None = None) -> MaceDiagnostic:
    first_line = message.strip().splitlines()[0] if message.strip() else "mace exited with an unknown error"
    category_match = re.match(r"^(?P<category>[^:\s]+):\s*(?P<message>.*)$", first_line)
    diagnostic_message = category_match.group("message") if category_match else first_line
    position_match = re.search(r"\bat (?P<line>\d+):(?P<column>\d+)\b", diagnostic_message)
    code_match = re.search(r"\b(?P<code>mace\.[a-z0-9][a-z0-9.-]*)\b", diagnostic_message, re.IGNORECASE)

    source_range = None
    if position_match:
        source_range = MaceSourceRange(
            start=MacePosition(
                line=int(position_match.group("line")),
                column=int(position_match.group("column")),
            )
        )

    return MaceDiagnostic(
        category=category_match.group("category") if category_match else None,
        code=code_match.group("code") if code_match else None,
        message=diagnostic_message,
        range=source_range,
        path=path,
    )


def _source_path_from_args(args: list[str]) -> str | None:
    if args[0] in {"json", "output", "import"}:
        return args[1]
    return None
