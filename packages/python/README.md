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
`json_text` and `output` are deprecated aliases for `json`; the CLI-backed
`import_*` functions and `mace_path` option have been removed.

## Security: remote imports are not sandboxed

`cwd` bounds the entry file and every *local* import, but HTTP(S) imports are
deliberately unrestricted. A `.mace` file you did not write can contain:

```mace
from 'http://169.254.169.254/latest/meta-data/iam/' import Role;
```

Evaluating it makes this process issue that request, including to cloud
metadata endpoints or hosts behind your firewall. There is no allowlist, no
per-origin opt-in, and no egress control. If you evaluate configuration from an
untrusted source, do not use this package on a host with sensitive network
reachability, or pre-validate the file for `http://` and `https://` imports
yourself.

The result is a Python dictionary containing ordinary strings, exact integers,
floats, booleans, nested dictionaries, lists, and null values. Hex values
remain formatted strings. On failure, `MaceError.diagnostic` contains
available structured category, code, range, and source path. `exit_code` is
retained as 1 for compatibility; no subprocess is involved.

Calls default to 30 seconds, accept a positive `timeout_ms` override, and
support explicit cancellation through `CancellationToken.cancel()` (including
from another Python thread). All failures remain `MaceError` with distinct
diagnostic codes for timeout and cancellation.

Native libraries must be staged before building. Wheels are platform-tagged
and contain only their target library. The sdist requires all eight supported
libraries and carries them with the build backend configuration, so it can
build a platform wheel offline with Hatchling already installed. The hook
rejects missing targets and untested wheel tags. CI tests this package against
all eight variants once a processor release is pinned, so publication is
blocked until then.
