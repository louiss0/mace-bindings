# mace_dart

Dart FFI bindings for the Mace processor shared library. Dart 3.12.2+ runs
processor evaluation in a separate isolate instead of launching a CLI process.

```dart
import 'package:mace_dart/mace_dart.dart';

final value = await json('./config.mace', cwd: '.');
final inline = await transform("[output = 'data']\n{ name: 'Ada', }");
final runtime = await json('./runtime.mace', input: '{ env: "prod", }');
```

`json(path, {input?, cwd?, timeoutMs?, cancellation?})` reads a file inside the workspace root `cwd`.
`transform(source, {input?, cwd?, sourceName?, timeoutMs?, cancellation?})` evaluates source directly,
resolving imports against that workspace. `input` is a Mace record literal.
`jsonText` and `output` remain as deprecated aliases; CLI-backed `import*`
functions and `macePath` are removed. Results contain nested Dart maps and
lists. Errors retain `MaceError` with structured diagnostics; `exitCode` is
compatibility-only.

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

A call defaults to a 30-second deadline; `timeoutMs` overrides it with a
positive value. Pass a `MaceCancellationController` to cancel an in-flight
call while the evaluation isolate is blocked in native code.

The library is selected by OS and architecture. Stage the native library in
`bin/<target>/` before running tests or builds. The code-assets build hook
bundles the staged library for compiled CLI applications:
`dart build cli --target=bin/processor_smoke.dart --output build/smoke`.
Single-file `dart compile exe` is not supported.

## Supported platforms

Libraries are published for `darwin-amd64`, `darwin-arm64`, `windows-amd64`,
`linux-amd64-glibc`, and `linux-arm64-glibc`. On `linux-*-musl` and
`windows-arm64` this package throws `MaceError` explaining that the processor
does not publish a library there, rather than failing to load one. The musl
build is excluded because it segfaults when called from C; the reason is
recorded in the processor's `processor-targets.json`. Do not work around this
by hand-placing a library.

The release workflow stages the pinned processor artifact and runs these
tests against it before anything is published.
