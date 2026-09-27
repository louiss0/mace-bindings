import 'dart:io' show Directory, File, HttpServer, InternetAddress;

import 'package:mace_dart/mace_dart.dart';
import 'package:path/path.dart' as path;
import 'package:test/test.dart';

void main() {
  group('processor bindings', () {
    late Directory workspace;

    setUp(
      () => workspace = Directory.systemTemp.createTempSync('mace-dart-test-'),
    );
    tearDown(() => workspace.deleteSync(recursive: true));

    test('evaluates source without the CLI', () async {
      expect(
        await transform(
          "[output = 'data']\n{ name: 'Ada', score: 42, tags: ['a', 'b'], }",
          cwd: workspace.path,
        ),
        equals({
          'name': 'Ada',
          'score': 42,
          'tags': ['a', 'b'],
        }),
      );
    });

    test('evaluates files with Mace input and preserves aliases', () async {
      final file = File(path.join(workspace.path, 'config.mace'));
      file.writeAsStringSync(
        "|===|\nschema Runtime: { env: string, };\n|===|\n"
        "[output = 'data', parse = Runtime]\n{ env: \$env, }",
      );
      expect(
        await json(file.path, input: '{ env: "prod", }', cwd: workspace.path),
        equals({'env': 'prod'}),
      );
      expect(
        await jsonText(
          file.path,
          input: '{ env: "prod", }',
          cwd: workspace.path,
        ),
        equals({'env': 'prod'}),
      );
      final alias = File(path.join(workspace.path, 'alias.mace'));
      alias.writeAsStringSync("[output = 'data']\n{ enabled: true, }");
      expect(
        await output(alias.path, cwd: workspace.path),
        equals({'enabled': true}),
      );
    });

    test('cancels an evaluation with a controller', () async {
      final cancellation = MaceCancellationController()..cancel();
      expect(
        transform(
          "[output = 'data']\n{ enabled: true, }",
          cwd: workspace.path,
          cancellation: cancellation,
        ),
        throwsA(
          isA<MaceError>().having(
            (error) => error.diagnostic.code,
            'code',
            'mace.runtime.cancelled',
          ),
        ),
      );
    });

    test('reports a timeout with its own diagnostic code', () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) {}, onError: (_) {});
      addTearDown(() async {
        await server.close(force: true);
      });
      expect(
        transform(
          "|===|\nfrom 'http://${server.address.address}:${server.port}/types.mace' import Age;\n|===|\n[output = 'data']\n{ age: 42, }",
          cwd: workspace.path,
          timeoutMs: 100,
        ),
        throwsA(
          isA<MaceError>().having(
            (error) => error.diagnostic.code,
            'code',
            'mace.runtime.timeout',
          ),
        ),
      );
    });

    test('reports structured diagnostics', () async {
      final file = File(path.join(workspace.path, 'invalid.mace'));
      file.writeAsStringSync('{ nope: }');
      try {
        await json(file.path, cwd: workspace.path);
        fail('expected MaceError');
      } on MaceError catch (error) {
        expect(error.diagnostic.category, 'parser');
        expect(error.diagnostic.range!.start.line, 1);
        expect(error.diagnostic.path, file.path);
      }
    });

    test('rejects entry files outside the workspace', () async {
      final elsewhere = Directory.systemTemp.createTempSync(
        'mace-dart-outside-',
      );
      addTearDown(() => elsewhere.deleteSync(recursive: true));
      final file = File(path.join(elsewhere.path, 'config.mace'));
      file.writeAsStringSync("[output = 'data']\n{ enabled: true, }");
      expect(json(file.path, cwd: workspace.path), throwsA(isA<MaceError>()));
    });
  });
}
