# mace-python

Official Python bindings for Mace.

## Status

This package provides a Python-native API around the `mace` CLI. Supported
release binaries are included in the package and selected automatically for the
current platform. Pass `mace_path` when a project needs a different Mace
executable.

## Development

This package is managed with `uv`.

```bash
cd packages/python
python -m uv sync
python -m uv build
```

## Usage

```python
from mace_python import json, output

value = json("./config.mace")
formatted = output("./config.mace")
```

## API

- `json(path, input=None, mace_path=None, cwd=None)`
- `json_text(path, input=None, mace_path=None, cwd=None)`
- `output(path, mace_path=None, cwd=None)`
- `nodes(path, mace_path=None, cwd=None)`
- `import_json(input_text, mace_path=None, cwd=None)`
- `import_yaml(input_text, mace_path=None, cwd=None)`
- `import_toml(input_text, mace_path=None, cwd=None)`
- `import_file(path, mace_path=None, cwd=None)`

All `mace_path` arguments are optional; the package uses its bundled platform
binary when they are omitted.
