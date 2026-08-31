import 'dart:ffi' show Abi;
import 'dart:io' show Directory, File, Platform, Process;
import 'dart:isolate' show Isolate;

import 'package:mace_dart/mace_dart.dart';
import 'package:path/path.dart' as path;
import 'package:test/test.dart';

final macePath = Platform.environment['MACE_PATH'];

void main() {
  group('Mace CLI bindings', () {
    test('passes runtime input to the Mace CLI', () async {
      final directory = Directory.systemTemp.createTempSync('mace-dart-test-');
      addTearDown(() => _delete(directory));

      final file = File(path.join(directory.path, 'runtime.mace'));
      file.writeAsStringSync(
        '|===|\n'
        'schema Runtime: { env: string, };\n'
        '|===|\n'
        "[output = 'data', parse = Runtime]\n"
        '{\n'
        '  env: \$env,\n'
        '}\n',
      );

      final command = macePath ?? await _bundledMacePath();
      final completed = await Process.run(command, ['output', file.path]);
      print('Mace CLI runtime output: ${(completed.stdout as String).trim()}');

      final record = macePath == null
          ? await json(file.path, input: '{ env: "prod", }')
          : await json(file.path, input: '{ env: "prod", }', macePath: macePath);

      expect(record, equals({'env': 'prod'}));
    });

    test('transforms every value operation into a record', () async {
      final directory = Directory.systemTemp.createTempSync('mace-dart-test-');
      addTearDown(() => _delete(directory));

      final file = File(path.join(directory.path, 'config.mace'));
      file.writeAsStringSync('{ name: "Mace", }');

      expect(
        await transform('{ name: "Mace", }', macePath: macePath),
        equals({'name': 'Mace'}),
      );
      expect(
        await jsonText(file.path, macePath: macePath),
        equals({'name': 'Mace'}),
      );

      final command = macePath ?? await _bundledMacePath();
      final completed = await Process.run(command, ['output', file.path]);
      print('Mace CLI output: ${(completed.stdout as String).trim()}');

      final record = await output(file.path, macePath: macePath);
      print('Mace parsed output: $record');
      expect(record, equals({'name': 'Mace'}));
      expect(await importJson('{"name":"Mace"}', macePath: macePath), equals({'name': 'Mace'}));
      expect(await importYaml('name: Mace', macePath: macePath), equals({'name': 'Mace'}));
      expect(await importToml('name = "Mace"', macePath: macePath), equals({'name': 'Mace'}));
    });

    test('exposes a diagnostic when Mace rejects source', () async {
      final directory = Directory.systemTemp.createTempSync('mace-dart-test-');
      addTearDown(() => _delete(directory));

      final file = File(path.join(directory.path, 'invalid.mace'));
      file.writeAsStringSync('{ nope: }');

      try {
        final record = await json(file.path, macePath: macePath);
        fail('expected MaceError, received $record');
      } on MaceError catch (error) {
        expect(error.message, 'parser: expected expression at 1:9 near "}"');
        expect(error.diagnostic.category, 'parser');
        expect(error.diagnostic.message, 'expected expression at 1:9 near "}"');
        expect(error.diagnostic.range, isNotNull);
        expect(error.diagnostic.range!.start.line, 1);
        expect(error.diagnostic.range!.start.column, 9);
        expect(error.diagnostic.path, file.path);
      }
    });
  });
}

Future<String> _bundledMacePath() async {
  final target = _targetFromAbi();
  if (target == null) {
    throw StateError('Unsupported platform for the bundled Mace binary.');
  }

  final libraryUri = await Isolate.resolvePackageUri(Uri.parse('package:mace_dart/mace_dart.dart'));
  if (libraryUri == null) {
    throw StateError('Unable to resolve the mace_dart package for its bundled binary.');
  }

  final packageRoot = Directory.fromUri(libraryUri).parent.parent;
  final executable = Platform.isWindows ? 'mace.exe' : 'mace';
  return path.join(packageRoot.path, 'bin', target, executable);
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

void _delete(Directory directory) {
  directory.deleteSync(recursive: true);
}
