"""Reject a universally tagged wheel when it bundles native processor code."""

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        if self.target_name == "sdist":
            raise RuntimeError("Do not publish an sdist until the pinned processor source and Go dependencies are vendored")
        if self.target_name != "wheel" or version != "standard":
            return
        platform = os.environ.get("MACE_WHEEL_PLATFORM")
        if not platform:
            raise RuntimeError("MACE_WHEEL_PLATFORM must name the verified target of this wheel")
        libraries = list((Path(self.root) / "src" / "mace_python" / "bin").glob("*/*"))
        native = [item for item in libraries if item.suffix in {".so", ".dll", ".dylib"}]
        if len(native) != 1:
            raise RuntimeError("A platform wheel must contain exactly one staged processor library")
        target = native[0].parent.name
        architectures = {"amd64": ("x86_64", "amd64"), "arm64": ("aarch64", "arm64")}
        architecture = target.split("-")[1]
        if not any(part in platform for part in architectures[architecture]):
            raise RuntimeError(f"Wheel tag {platform} does not match staged native target {target}")
        build_data["tag"] = f"py3-none-{platform}"
        build_data["pure_python"] = False
