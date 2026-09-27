# mace-python

Python bindings for the Mace processor C ABI. Python 3.12+ uses `ctypes` to
load the bundled native library. The package never starts a Mace CLI process.

```python
from mace_python import json, transform

value = json('./config.mace', cwd='.')
inline = transform("[output = 'data']\n{ name: 'Ada', }")
value_with_input = json('./runtime.mace', input='{ env: "prod", }')
```

`json(path, input=None, cwd=None, timeout_ms=None, cancellation=None)` evaluates a file inside the workspace root
`cwd`. `transform(source, input=None, cwd=None, source_name=None, timeout_ms=None, cancellation=None)` evaluates
in-memory source and resolves imports from that workspace; the optional
`source_name` labels diagnostics only. `input` is a Mace record literal.
Remote HTTP(S) imports remain available. `json_text` and `output` are
deprecated aliases for `json`; the CLI-backed `import_*` functions and
`mace_path` option have been removed.

The result is a Python dictionary containing ordinary strings, exact integers,
floats, booleans, nested dictionaries, lists, and null values. Hex values
remain formatted strings. On failure, `MaceError.diagnostic` contains
available structured category, code, range, and source path. `exit_code` is
retained as 1 for compatibility; no subprocess is involved.

Calls default to 30 seconds, accept a positive `timeout_ms` override, and
support explicit cancellation through `CancellationToken.cancel()` (including
from another Python thread). All failures remain `MaceError` with distinct
diagnostic codes for timeout and cancellation.

Native libraries must be staged before testing or building wheels. Wheels are
platform-tagged; an offline-buildable sdist and release artifact verification
remain incomplete, so publication is currently blocked.
