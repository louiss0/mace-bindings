"""Bundle only the target library in wheels; retain all published targets in sdists."""

import os
import platform
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


# Only the targets the processor release actually publishes. musl and Windows
# arm64 are excluded on purpose; see `unsupported` in the processor's
# processor-targets.json. Do not add one before the release publishes it.
NATIVE_LIBRARIES = {
    "darwin-amd64": ("libmace_processor.dylib", "macosx_11_0_x86_64"),
    "darwin-arm64": ("libmace_processor.dylib", "macosx_11_0_arm64"),
    "windows-amd64": ("mace_processor.dll", "win_amd64"),
    "linux-amd64-glibc": ("libmace_processor.so", "manylinux_2_17_x86_64"),
    "linux-arm64-glibc": ("libmace_processor.so", "manylinux_2_17_aarch64"),
}


def current_target() -> str:
    system = {"darwin": "darwin", "windows": "windows", "linux": "linux"}.get(platform.system().lower())
    architecture = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    if system is None or architecture is None:
        raise RuntimeError("Unsupported native processor platform")
    if system == "linux":
        loader = "/lib/ld-musl-x86_64.so.1" if architecture == "amd64" else "/lib/ld-musl-aarch64.so.1"
        return f"linux-{architecture}-{'musl' if Path(loader).exists() else 'glibc'}"
    return f"{system}-{architecture}"


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        native_root = Path(self.root) / "src" / "mace_python" / "bin"
        if self.target_name == "sdist":
            missing = [target for target, (name, _) in NATIVE_LIBRARIES.items() if not (native_root / target / name).is_file()]
            if missing:
                raise RuntimeError(f"Cannot publish an incomplete native sdist; missing: {', '.join(missing)}")
            return
        if self.target_name != "wheel" or version != "standard":
            return

        target = os.environ.get("MACE_NATIVE_TARGET") or current_target()
        if target not in NATIVE_LIBRARIES:
            raise RuntimeError(f"Unsupported processor target: {target}")
        name, expected_tag = NATIVE_LIBRARIES[target]
        tag = os.environ.get("MACE_WHEEL_PLATFORM")
        if tag != expected_tag:
            raise RuntimeError(f"Processor target {target} requires tested wheel tag {expected_tag}, got {tag!r}")
        library = native_root / target / name
        if not library.is_file():
            raise RuntimeError(f"Missing staged processor library: {library}")
        build_data["force_include"][str(library)] = f"mace_python/bin/{target}/{name}"
        build_data["tag"] = f"py3-none-{tag}"
        build_data["pure_python"] = False
