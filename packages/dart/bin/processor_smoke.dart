import 'dart:convert';
import 'dart:io';

import 'package:mace_dart/mace_dart.dart';

Future<void> main() async {
  final result = await transform(
    "[output = 'data']\n{ enabled: true, }",
    cwd: Directory.current.path,
  );
  stdout.writeln(jsonEncode(result));
}
