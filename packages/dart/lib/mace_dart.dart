/// Official Dart bindings for the Mace configuration language.
///
/// Provides a Dart-native API around the released `mace` CLI. The bundled
/// platform binary is selected automatically; pass `macePath` when a project
/// needs a different Mace executable.
library;

import 'dart:convert' show jsonDecode, utf8;
import 'dart:ffi' show Abi;
import 'dart:io' show Directory, File, Process, Platform;
import 'dart:isolate' show Isolate;

import 'package:path/path.dart' as path;

/// Any value that can appear inside a [MaceRecord].
typedef MaceValue = Object?;

/// A record deserialized from Mace JSON output.
typedef MaceRecord = Map<String, MaceValue>;

/// A one-based position inside a Mace source file, as reported by the CLI.
final class MacePosition {
  final int line;
  final int column;

  const MacePosition({required this.line, required this.column});
}

/// The source range reported by a Mace diagnostic.
final class MaceSourceRange {
  final MacePosition start;

  const MaceSourceRange({required this.start});
}

/// A best-effort structured view of the Mace CLI stderr.
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

/// The error thrown whenever the Mace CLI exits without success.
final class MaceError implements Exception {
  final String message;
  final int exitCode;
  final MaceDiagnostic diagnostic;

  MaceError(String message, [int? exitCode, MaceDiagnostic? diagnostic])
    : message = message.isEmpty ? 'mace exited with an unknown error' : message,
      exitCode = exitCode ?? 1,
      diagnostic = diagnostic ?? _diagnosticFromMessage(message);

  @override
  String toString() => message;
}

/// Evaluates the Mace file at [path] and returns its record.
Future<MaceRecord> json(String path, {String? input, String? macePath, String? cwd}) async {
  final arguments = ['json', path, if (input != null) ...['--input', input]];
  final result = await _runMace(arguments, macePath: macePath, cwd: cwd);
  return _transformJsonOutput(result);
}

/// Evaluates [source] through a temporary file and returns its record.
Future<MaceRecord> transform(String source, {String? input, String? macePath, String? cwd}) async {
  final directory = Directory.systemTemp.createTempSync('mace-dart-source-');
  try {
    final sourceFile = File(path.join(directory.path, 'source.mace'));
    sourceFile.writeAsStringSync(source, encoding: utf8);
    return await json(sourceFile.path, input: input, macePath: macePath, cwd: cwd);
  } finally {
    _removeDirectory(directory);
  }
}

/// Alias for [json] retained for parity with the other bindings.
Future<MaceRecord> jsonText(String path, {String? input, String? macePath, String? cwd}) {
  return json(path, input: input, macePath: macePath, cwd: cwd);
}

/// Alias for [json] retained for parity with the other bindings.
Future<MaceRecord> output(String path, {String? macePath, String? cwd}) {
  return json(path, macePath: macePath, cwd: cwd);
}

/// Imports [input] as JSON via the Mace CLI and returns its record.
Future<MaceRecord> importJson(String input, {String? macePath, String? cwd}) {
  return _importText('input.json', input, macePath: macePath, cwd: cwd);
}

/// Imports [input] as YAML via the Mace CLI and returns its record.
Future<MaceRecord> importYaml(String input, {String? macePath, String? cwd}) {
  return _importText('input.yaml', input, macePath: macePath, cwd: cwd);
}

/// Imports [input] as TOML via the Mace CLI and returns its record.
Future<MaceRecord> importToml(String input, {String? macePath, String? cwd}) {
  return _importText('input.toml', input, macePath: macePath, cwd: cwd);
}

/// Imports the file at [importPath] via the Mace CLI and returns its record.
Future<MaceRecord> importFile(String importPath, {String? macePath, String? cwd}) async {
  final directory = Directory.systemTemp.createTempSync('mace-dart-import-');
  try {
    final result = await _runMace(
      ['import', importPath, '--output-dir', directory.path],
      macePath: macePath,
      cwd: cwd,
    );
    final outputPath = result
        .split(RegExp(r'\r?\n'))
        .where((line) => line.endsWith('.mace'))
        .firstOrNull;
    if (outputPath == null) {
      throw MaceError('import did not report an output file');
    }

    final sourceFile = File(outputPath);
    return await transform(sourceFile.readAsStringSync(encoding: utf8), macePath: macePath, cwd: cwd);
  } finally {
    _removeDirectory(directory);
  }
}

Future<MaceRecord> _importText(String name, String input, {String? macePath, String? cwd}) async {
  final directory = Directory.systemTemp.createTempSync('mace-dart-');
  try {
    final inputFile = File(path.join(directory.path, name));
    inputFile.writeAsStringSync(input, encoding: utf8);
    return await importFile(inputFile.path, macePath: macePath, cwd: cwd);
  } finally {
    _removeDirectory(directory);
  }
}

MaceRecord _transformJsonOutput(String result) {
  return jsonDecode(result) as MaceRecord;
}

Future<String> _runMace(List<String> arguments, {String? macePath, String? cwd}) async {
  final command = macePath ?? await _bundledMacePath() ?? 'mace';
  final completed = await Process.run(command, arguments, workingDirectory: cwd);
  final stderr = (completed.stderr as String).trim();
  if (completed.exitCode != 0) {
    final message = stderr.isEmpty ? 'mace exited with code ${completed.exitCode}' : stderr;
    throw MaceError(message, completed.exitCode, _diagnosticFromMessage(message, _sourcePathFromArgs(arguments)));
  }
  return (completed.stdout as String).trim();
}

Future<String?> _bundledMacePath() async {
  final target = _targetFromAbi();
  if (target == null) return null;

  final libraryUri = await Isolate.resolvePackageUri(Uri.parse('package:mace_dart/mace_dart.dart'));
  if (libraryUri == null) return null;

  final packageRoot = Directory.fromUri(libraryUri).parent.parent;
  final executable = Platform.isWindows ? 'mace.exe' : 'mace';
  final bundledPath = path.join(packageRoot.path, 'bin', target, executable);
  return File(bundledPath).existsSync() ? bundledPath : null;
}

String? _targetFromAbi() {
  return switch (Abi.current()) {
    Abi.macosX64 => 'darwin-amd64',
    Abi.macosArm64 => 'darwin-arm64',
    Abi.linuxX64 => 'linux-amd64',
    Abi.linuxArm64 => 'linux-arm64',
    Abi.windowsX64 => 'windows-amd64',
    Abi.windowsArm64 => 'windows-arm64',
    _ => null,
  };
}

MaceDiagnostic _diagnosticFromMessage(String message, [String? sourcePath]) {
  final lines = message.trim().split(RegExp(r'\r?\n'));
  final firstLine = lines.firstOrNull ?? 'mace exited with an unknown error';
  final categoryMatch = RegExp(r'^(?<category>[^:\s]+):\s*(?<message>.*)$').firstMatch(firstLine);
  final diagnosticMessage = categoryMatch?.namedGroup('message') ?? firstLine;
  final positionMatch = RegExp(r'\bat (?<line>\d+):(?<column>\d+)\b').firstMatch(diagnosticMessage);
  final codeMatch = RegExp(r'\b(?<code>mace\.[a-z0-9][a-z0-9.-]*)\b', caseSensitive: false).firstMatch(diagnosticMessage);

  final range = positionMatch == null
      ? null
      : MaceSourceRange(
          start: MacePosition(
            line: int.parse(positionMatch.namedGroup('line')!),
            column: int.parse(positionMatch.namedGroup('column')!),
          ),
        );

  return MaceDiagnostic(
    category: categoryMatch?.namedGroup('category'),
    code: codeMatch?.namedGroup('code'),
    message: diagnosticMessage,
    range: range,
    path: sourcePath,
  );
}

String? _sourcePathFromArgs(List<String> arguments) {
  const commandsWithSourcePath = {'json', 'output', 'import'};
  return commandsWithSourcePath.contains(arguments.firstOrNull) && arguments.length > 1
      ? arguments[1]
      : null;
}

void _removeDirectory(Directory directory) {
  directory.deleteSync(recursive: true);
}
