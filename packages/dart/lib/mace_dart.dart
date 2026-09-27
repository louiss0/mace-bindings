/// Processor-backed bindings for the Mace configuration language.
library;

import 'dart:convert' show utf8;
import 'dart:ffi';
import 'dart:io' show Directory, File, Platform;
import 'dart:isolate' show Isolate;

import 'package:ffi/ffi.dart';
import 'package:path/path.dart' as path;

typedef MaceValue = Object?;
typedef MaceRecord = Map<String, MaceValue>;

final class MacePosition {
  final int line;
  final int column;
  const MacePosition({required this.line, required this.column});
}

final class MaceSourceRange {
  final MacePosition start;
  final MacePosition? end;
  const MaceSourceRange({required this.start, this.end});
}

final class MaceDiagnostic {
  final String message;
  final String? category;
  final String? code;
  final MaceSourceRange? range;
  final String? path;

  const MaceDiagnostic({
    required this.message,
    this.category,
    this.code,
    this.range,
    this.path,
  });
}

final class MaceError implements Exception {
  final String message;
  final int exitCode = 1;
  final MaceDiagnostic diagnostic;

  MaceError(this.message, [MaceDiagnostic? diagnostic])
    : diagnostic = diagnostic ?? MaceDiagnostic(message: message);

  @override
  String toString() => message;
}

/// Cancels one or more evaluations that use this controller.
final class MaceCancellationController {
  bool _cancelled = false;
  final Set<void Function()> _actions = {};

  void cancel() {
    _cancelled = true;
    for (final action in _actions.toList()) {
      action();
    }
  }

  void _listen(void Function() action) {
    _actions.add(action);
    if (_cancelled) action();
  }

  void _stopListening(void Function() action) => _actions.remove(action);
}

class _Processor {
  final DynamicLibrary library;
  _Processor(this.library) {
    if (_abiMajor() != 1) throw MaceError('Incompatible processor ABI');
  }

  late final _abiMajor = library
      .lookupFunction<Uint32 Function(), int Function()>('mace_abi_major');
  late final _file = library
      .lookupFunction<
        Uint64 Function(Uint64, Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>),
        int Function(int, Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>)
      >('mace_process_file_with_request');
  late final _source = library
      .lookupFunction<
        Uint64 Function(Uint64, Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>),
        int Function(int, Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>)
      >('mace_process_source_with_request');
  late final _newRequest = library
      .lookupFunction<Uint64 Function(Uint32), int Function(int)>(
        'mace_request_new',
      );
  late final _cancelRequest = library
      .lookupFunction<Void Function(Uint64), void Function(int)>(
        'mace_request_cancel',
      );
  late final _freeRequest = library
      .lookupFunction<Void Function(Uint64), void Function(int)>(
        'mace_request_free',
      );

  int startRequest(int? timeoutMs) => _newRequest(timeoutMs ?? 0);
  void cancelRequest(int request) => _cancelRequest(request);
  void freeRequest(int request) => _freeRequest(request);
  late final _root = library
      .lookupFunction<Uint64 Function(Uint64), int Function(int)>(
        'mace_result_root',
      );
  late final _error = library
      .lookupFunction<
        Pointer<Utf8> Function(Uint64),
        Pointer<Utf8> Function(int)
      >('mace_result_error');
  late final _errorKind = library
      .lookupFunction<
        Pointer<Utf8> Function(Uint64),
        Pointer<Utf8> Function(int)
      >('mace_result_error_kind');
  late final _errorCode = library
      .lookupFunction<
        Pointer<Utf8> Function(Uint64),
        Pointer<Utf8> Function(int)
      >('mace_result_error_code');
  late final _errorLine = library
      .lookupFunction<Uint32 Function(Uint64), int Function(int)>(
        'mace_result_error_line',
      );
  late final _errorColumn = library
      .lookupFunction<Uint32 Function(Uint64), int Function(int)>(
        'mace_result_error_column',
      );
  late final _errorEndLine = library
      .lookupFunction<Uint32 Function(Uint64), int Function(int)>(
        'mace_result_error_end_line',
      );
  late final _errorEndColumn = library
      .lookupFunction<Uint32 Function(Uint64), int Function(int)>(
        'mace_result_error_end_column',
      );
  late final _freeResult = library
      .lookupFunction<Void Function(Uint64), void Function(int)>(
        'mace_result_free',
      );
  late final _stringLength = library
      .lookupFunction<
        Uint64 Function(Pointer<Utf8>),
        int Function(Pointer<Utf8>)
      >('mace_string_length');
  late final _freeString = library
      .lookupFunction<
        Void Function(Pointer<Utf8>),
        void Function(Pointer<Utf8>)
      >('mace_string_free');
  late final _kind = library
      .lookupFunction<Uint32 Function(Uint64), int Function(int)>(
        'mace_value_kind',
      );
  late final _integer = library
      .lookupFunction<Int64 Function(Uint64), int Function(int)>(
        'mace_value_int',
      );
  late final _decimal = library
      .lookupFunction<Double Function(Uint64), double Function(int)>(
        'mace_value_float',
      );
  late final _boolean = library
      .lookupFunction<Uint8 Function(Uint64), int Function(int)>(
        'mace_value_boolean',
      );
  late final _string = library
      .lookupFunction<
        Pointer<Utf8> Function(Uint64),
        Pointer<Utf8> Function(int)
      >('mace_value_string');
  late final _valueStringLength = library
      .lookupFunction<Uint64 Function(Uint64), int Function(int)>(
        'mace_value_string_length',
      );
  late final _arrayLength = library
      .lookupFunction<Uint64 Function(Uint64), int Function(int)>(
        'mace_value_array_length',
      );
  late final _arrayItem = library
      .lookupFunction<Uint64 Function(Uint64, Uint64), int Function(int, int)>(
        'mace_value_array_item',
      );
  late final _recordLength = library
      .lookupFunction<Uint64 Function(Uint64), int Function(int)>(
        'mace_value_record_length',
      );
  late final _recordKey = library
      .lookupFunction<
        Pointer<Utf8> Function(Uint64, Uint64),
        Pointer<Utf8> Function(int, int)
      >('mace_value_record_key');
  late final _recordKeyLength = library
      .lookupFunction<Uint64 Function(Uint64, Uint64), int Function(int, int)>(
        'mace_value_record_key_length',
      );
  late final _recordValue = library
      .lookupFunction<Uint64 Function(Uint64, Uint64), int Function(int, int)>(
        'mace_value_record_value',
      );

  String? readString(Pointer<Utf8> pointer, [int? length]) {
    if (pointer.address == 0) return null;
    try {
      return utf8.decode(
        pointer.cast<Uint8>().asTypedList(length ?? _stringLength(pointer)),
      );
    } finally {
      _freeString(pointer);
    }
  }

  MaceValue readValue(int value) {
    switch (_kind(value)) {
      case 0:
      case 1:
        return null;
      case 2:
      case 5:
      case 6:
        return readString(_string(value), _valueStringLength(value));
      case 3:
        return _integer(value);
      case 4:
        return _decimal(value);
      case 7:
        return _boolean(value) != 0;
      case 8:
        return List<MaceValue>.generate(
          _arrayLength(value),
          (index) => readValue(_arrayItem(value, index)),
        );
      case 9:
        return Map.fromEntries(
          List.generate(
            _recordLength(value),
            (index) => MapEntry(
              readString(
                _recordKey(value, index),
                _recordKeyLength(value, index),
              )!,
              readValue(_recordValue(value, index)),
            ),
          ),
        );
      default:
        throw MaceError('Unsupported Mace value kind: ${_kind(value)}');
    }
  }

  MaceRecord evaluate(
    bool file,
    String text,
    String workspace,
    String? input,
    String? name,
    int request,
  ) {
    final contents = text.toNativeUtf8();
    final root = workspace.toNativeUtf8();
    final injection = input?.toNativeUtf8() ?? Pointer<Utf8>.fromAddress(0);
    int result;
    try {
      result = file
          ? _file(request, contents, root, injection)
          : _source(request, contents, root, injection);
    } finally {
      calloc.free(contents);
      calloc.free(root);
      if (input != null) calloc.free(injection);
    }
    try {
      final message = readString(_error(result));
      if (message != null) {
        final kind = readString(_errorKind(result));
        final line = _errorLine(result);
        final endLine = _errorEndLine(result);
        final diagnostic = MaceDiagnostic(
          message: message,
          category: switch (kind) {
            'syntax' => 'parser',
            'lexical' => 'lexer',
            _ => kind,
          },
          code: readString(_errorCode(result)),
          path: name,
          range: line == 0
              ? null
              : MaceSourceRange(
                  start: MacePosition(line: line, column: _errorColumn(result)),
                  end: endLine == 0
                      ? null
                      : MacePosition(
                          line: endLine,
                          column: _errorEndColumn(result),
                        ),
                ),
        );
        throw MaceError(message, diagnostic);
      }
      return readValue(_root(result)) as MaceRecord;
    } finally {
      _freeResult(result);
    }
  }
}

/// Only the targets the processor release publishes; see
/// `tools/native/manifest.mjs` in the bindings repository.
const publishedTargets = {
  'darwin-amd64',
  'darwin-arm64',
  'linux-amd64-glibc',
  'linux-arm64-glibc',
  'windows-amd64',
};

String _target() {
  final platform = switch (Abi.current()) {
    Abi.macosX64 => 'darwin-amd64',
    Abi.macosArm64 => 'darwin-arm64',
    Abi.linuxX64 => 'linux-amd64',
    Abi.linuxArm64 => 'linux-arm64',
    Abi.windowsX64 => 'windows-amd64',
    Abi.windowsArm64 => 'windows-arm64',
    _ => throw MaceError('Unsupported native processor platform'),
  };
  final resolved = Platform.isLinux
      ? '$platform-${_isMusl() ? 'musl' : 'glibc'}'
      : platform;
  if (!publishedTargets.contains(resolved)) {
    throw MaceError(
      'The processor does not publish a library for $resolved yet. '
      'musl and Windows arm64 are not released.',
    );
  }
  return resolved;
}

bool _isMusl() =>
    File('/lib/ld-musl-x86_64.so.1').existsSync() ||
    File('/lib/ld-musl-aarch64.so.1').existsSync();

final class _Evaluation {
  final bool file;
  final String contents;
  final String workspace;
  final String? input;
  final String? name;
  final String libraryPath;
  final int request;

  const _Evaluation(
    this.file,
    this.contents,
    this.workspace,
    this.input,
    this.name,
    this.libraryPath,
    this.request,
  );
}

Future<MaceRecord> _runInIsolate(_Evaluation evaluation) => Isolate.run(
  () => _Processor(DynamicLibrary.open(evaluation.libraryPath)).evaluate(
    evaluation.file,
    evaluation.contents,
    evaluation.workspace,
    evaluation.input,
    evaluation.name,
    evaluation.request,
  ),
);

Future<MaceRecord> _evaluate(
  bool file,
  String contents,
  String? input,
  String? cwd,
  String? name,
  int? timeoutMs,
  MaceCancellationController? cancellation,
) async {
  if (timeoutMs != null && (timeoutMs <= 0 || timeoutMs > 0xffffffff)) {
    throw MaceError('timeoutMs must be a positive 32-bit integer');
  }
  final libraryUri = await Isolate.resolvePackageUri(
    Uri.parse('package:mace_dart/mace_dart.dart'),
  );
  final libraryName = Platform.isWindows
      ? 'mace_processor.dll'
      : Platform.isMacOS
      ? 'libmace_processor.dylib'
      : 'libmace_processor.so';
  final packageLibrary = libraryUri == null
      ? null
      : path.join(
          Directory.fromUri(libraryUri).parent.parent.path,
          'bin',
          _target(),
          libraryName,
        );
  // `dart build cli` places hook-provided libraries beside its bin/ folder.
  final bundleLibrary = path.join(
    File(Platform.resolvedExecutable).parent.parent.path,
    'lib',
    libraryName,
  );
  final libraryPath =
      packageLibrary != null && File(packageLibrary).existsSync()
      ? packageLibrary
      : bundleLibrary;
  if (!File(libraryPath).existsSync()) {
    throw MaceError('Bundled processor library is missing: $libraryPath');
  }

  final processor = _Processor(DynamicLibrary.open(libraryPath));
  final request = processor.startRequest(timeoutMs);
  void cancel() => processor.cancelRequest(request);
  cancellation?._listen(cancel);
  try {
    return await _runInIsolate(
      _Evaluation(
        file,
        contents,
        cwd ?? Directory.current.path,
        input,
        name,
        libraryPath,
        request,
      ),
    );
  } finally {
    cancellation?._stopListening(cancel);
    processor.freeRequest(request);
  }
}

/// Evaluates a Mace file inside the workspace root.
Future<MaceRecord> json(
  String path, {
  String? input,
  String? cwd,
  int? timeoutMs,
  MaceCancellationController? cancellation,
}) => _evaluate(true, path, input, cwd, path, timeoutMs, cancellation);

/// Evaluates Mace source directly, without writing a temporary file.
Future<MaceRecord> transform(
  String source, {
  String? input,
  String? cwd,
  String? sourceName,
  int? timeoutMs,
  MaceCancellationController? cancellation,
}) => _evaluate(false, source, input, cwd, sourceName, timeoutMs, cancellation);

/// Deprecated: use [json].
Future<MaceRecord> jsonText(String path, {String? input, String? cwd}) =>
    json(path, input: input, cwd: cwd);

/// Deprecated: use [json].
Future<MaceRecord> output(String path, {String? cwd}) => json(path, cwd: cwd);
