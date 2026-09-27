from __future__ import annotations

import ctypes
import platform
import sys
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from threading import Lock
from typing import Callable, TypeAlias, cast

MaceValue: TypeAlias = str | int | float | bool | None | list["MaceValue"] | dict[str, "MaceValue"]
MaceRecord: TypeAlias = dict[str, MaceValue]


@dataclass(frozen=True)
class MacePosition:
    line: int
    column: int


@dataclass(frozen=True)
class MaceSourceRange:
    start: MacePosition
    end: MacePosition | None = None


@dataclass(frozen=True)
class MaceDiagnostic:
    message: str
    category: str | None = None
    code: str | None = None
    range: MaceSourceRange | None = None
    path: str | None = None


class MaceError(RuntimeError):
    def __init__(self, message: str, diagnostic: MaceDiagnostic) -> None:
        super().__init__(message)
        self.exit_code = 1  # Compatibility with the CLI-backed API.
        self.diagnostic = diagnostic


class CancellationToken:
    def __init__(self) -> None:
        self._lock = Lock()
        self._cancelled = False
        self._actions: set[Callable[[], None]] = set()

    def cancel(self) -> None:
        with self._lock:
            self._cancelled = True
            actions = tuple(self._actions)
        for action in actions:
            action()

    def listen(self, action: Callable[[], None]) -> Callable[[], None]:
        with self._lock:
            self._actions.add(action)
            cancelled = self._cancelled
        if cancelled:
            action()

        def stop_listening() -> None:
            with self._lock:
                self._actions.discard(action)

        return stop_listening


def _platform_target() -> tuple[str, str]:
    system = "windows" if sys.platform == "win32" else sys.platform
    architecture = {
        "x86_64": "amd64",
        "AMD64": "amd64",
        "arm64": "arm64",
        "ARM64": "arm64",
        "aarch64": "arm64",
    }.get(platform.machine())
    if architecture is None or system not in {"windows", "darwin", "linux"}:
        raise MaceError("Unsupported native processor platform", MaceDiagnostic("Unsupported platform"))
    libc = "-glibc" if system == "linux" and platform.libc_ver()[0] == "glibc" else ""
    if system == "linux" and not libc:
        libc = "-musl"
    return f"{system}-{architecture}{libc}", {"windows": "mace_processor.dll", "darwin": "libmace_processor.dylib", "linux": "libmace_processor.so"}[system]


@cache
def _library() -> ctypes.CDLL:
    target, name = _platform_target()
    path = Path(__file__).resolve().parent / "bin" / target / name
    if not path.is_file():
        raise MaceError(f"Bundled processor library is missing: {path}", MaceDiagnostic("Bundled processor library is missing"))
    native = ctypes.CDLL(str(path))
    signatures: dict[str, tuple[list[type], type]] = {
        "mace_abi_major": ([], ctypes.c_uint32),
        "mace_process_file_with_request": ([ctypes.c_uint64, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p], ctypes.c_uint64),
        "mace_process_source_with_request": ([ctypes.c_uint64, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p], ctypes.c_uint64),
        "mace_request_new": ([ctypes.c_uint32], ctypes.c_uint64),
        "mace_request_cancel": ([ctypes.c_uint64], None),
        "mace_request_free": ([ctypes.c_uint64], None),
        "mace_result_root": ([ctypes.c_uint64], ctypes.c_uint64),
        "mace_result_free": ([ctypes.c_uint64], None),
        "mace_result_error": ([ctypes.c_uint64], ctypes.c_void_p),
        "mace_result_error_code": ([ctypes.c_uint64], ctypes.c_void_p),
        "mace_result_error_kind": ([ctypes.c_uint64], ctypes.c_void_p),
        "mace_value_kind": ([ctypes.c_uint64], ctypes.c_uint32),
        "mace_value_int": ([ctypes.c_uint64], ctypes.c_int64),
        "mace_value_float": ([ctypes.c_uint64], ctypes.c_double),
        "mace_value_boolean": ([ctypes.c_uint64], ctypes.c_uint8),
        "mace_value_string": ([ctypes.c_uint64], ctypes.c_void_p),
        "mace_value_string_length": ([ctypes.c_uint64], ctypes.c_uint64),
        "mace_value_array_length": ([ctypes.c_uint64], ctypes.c_uint64),
        "mace_value_array_item": ([ctypes.c_uint64, ctypes.c_uint64], ctypes.c_uint64),
        "mace_value_record_length": ([ctypes.c_uint64], ctypes.c_uint64),
        "mace_value_record_key": ([ctypes.c_uint64, ctypes.c_uint64], ctypes.c_void_p),
        "mace_value_record_key_length": ([ctypes.c_uint64, ctypes.c_uint64], ctypes.c_uint64),
        "mace_value_record_value": ([ctypes.c_uint64, ctypes.c_uint64], ctypes.c_uint64),
        "mace_string_free": ([ctypes.c_void_p], None),
    }
    for position in ("line", "column", "end_line", "end_column"):
        signatures[f"mace_result_error_{position}"] = ([ctypes.c_uint64], ctypes.c_uint32)
    for symbol, (arguments, result) in signatures.items():
        method = getattr(native, symbol)
        method.argtypes = arguments
        method.restype = result
    if native.mace_abi_major() != 1:
        raise MaceError("Incompatible processor ABI", MaceDiagnostic("Incompatible processor ABI"))
    return native


def _read_string(native: ctypes.CDLL, pointer: int, length: int | None = None) -> str | None:
    if not pointer:
        return None
    try:
        contents = ctypes.string_at(pointer, length) if length is not None else ctypes.string_at(pointer)
        return contents.decode("utf-8")
    finally:
        native.mace_string_free(pointer)


def _read_value(native: ctypes.CDLL, value: int) -> MaceValue:
    kind = native.mace_value_kind(value)
    if kind in (0, 1):
        return None
    if kind in (2, 5, 6):
        return _read_string(native, native.mace_value_string(value), native.mace_value_string_length(value))
    if kind == 3:
        return int(native.mace_value_int(value))
    if kind == 4:
        return float(native.mace_value_float(value))
    if kind == 7:
        return bool(native.mace_value_boolean(value))
    if kind == 8:
        return [_read_value(native, native.mace_value_array_item(value, index)) for index in range(native.mace_value_array_length(value))]
    if kind == 9:
        return {
            cast(str, _read_string(native, native.mace_value_record_key(value, index), native.mace_value_record_key_length(value, index))):
            _read_value(native, native.mace_value_record_value(value, index))
            for index in range(native.mace_value_record_length(value))
        }
    raise MaceError(f"Unsupported Mace value kind: {kind}", MaceDiagnostic("Unsupported Mace value kind"))


def _evaluate(symbol: str, source: str, input: str | None, cwd: str | None, source_name: str | None, timeout_ms: int | None, cancellation: CancellationToken | None) -> MaceRecord:
    native = _library()
    if timeout_ms is not None and (not isinstance(timeout_ms, int) or timeout_ms <= 0 or timeout_ms > 0xffffffff):
        raise MaceError("timeout_ms must be a positive 32-bit integer", MaceDiagnostic("Invalid timeout"))
    workspace = str(Path(cwd or Path.cwd()).resolve())
    request = native.mace_request_new(timeout_ms if timeout_ms is not None else 0)
    stop_listening = cancellation.listen(lambda: native.mace_request_cancel(request)) if cancellation else None
    try:
        result = getattr(native, symbol)(request, source.encode("utf-8"), workspace.encode("utf-8"), input.encode("utf-8") if input is not None else None)
        try:
            message = _read_string(native, native.mace_result_error(result))
            if message is not None:
                kind = _read_string(native, native.mace_result_error_kind(result))
                category = {"syntax": "parser", "lexical": "lexer"}.get(kind, kind)
                start_line = native.mace_result_error_line(result)
                end_line = native.mace_result_error_end_line(result)
                span = MaceSourceRange(
                    MacePosition(start_line, native.mace_result_error_column(result)),
                    MacePosition(end_line, native.mace_result_error_end_column(result)) if end_line else None,
                ) if start_line else None
                diagnostic = MaceDiagnostic(
                    message=message,
                    category=category,
                    code=_read_string(native, native.mace_result_error_code(result)),
                    range=span,
                    path=source_name,
                )
                raise MaceError(message, diagnostic)
            return cast(MaceRecord, _read_value(native, native.mace_result_root(result)))
        finally:
            native.mace_result_free(result)
    finally:
        if stop_listening:
            stop_listening()
        native.mace_request_free(request)


def json(path: str, input: str | None = None, cwd: str | None = None, timeout_ms: int | None = None, cancellation: CancellationToken | None = None) -> MaceRecord:
    return _evaluate("mace_process_file_with_request", path, input, cwd, path, timeout_ms, cancellation)


def transform(source: str, input: str | None = None, cwd: str | None = None, source_name: str | None = None, timeout_ms: int | None = None, cancellation: CancellationToken | None = None) -> MaceRecord:
    return _evaluate("mace_process_source_with_request", source, input, cwd, source_name, timeout_ms, cancellation)


def json_text(path: str, input: str | None = None, cwd: str | None = None) -> MaceRecord:
    return json(path, input=input, cwd=cwd)


def output(path: str, cwd: str | None = None) -> MaceRecord:
    return json(path, cwd=cwd)
