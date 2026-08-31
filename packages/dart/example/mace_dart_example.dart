import 'package:mace_dart/mace_dart.dart';

Future<void> main() async {
  final value = await transform('{ name: "Mace", }');
  print('transform: $value');
}
