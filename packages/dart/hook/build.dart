import 'dart:io';

import 'package:code_assets/code_assets.dart';
import 'package:hooks/hooks.dart';

void main(List<String> args) async {
  await build(args, (input, output) async {
    if (!input.config.buildCodeAssets) return;

    final target = input.config.code;
    final architecture = switch (target.targetArchitecture) {
      Architecture.x64 => 'amd64',
      Architecture.arm64 => 'arm64',
      final other => throw UnsupportedError(
        'Unsupported processor architecture: $other',
      ),
    };
    final platform = switch (target.targetOS) {
      OS.windows => 'windows',
      OS.macOS => 'darwin',
      OS.linux => 'linux',
      final other => throw UnsupportedError('Unsupported processor OS: $other'),
    };
    final runtime = platform == 'linux'
        ? '-${File('/lib/ld-musl-x86_64.so.1').existsSync() || File('/lib/ld-musl-aarch64.so.1').existsSync() ? 'musl' : 'glibc'}'
        : '';
    final libraryName = switch (target.targetOS) {
      OS.windows => 'mace_processor.dll',
      OS.macOS => 'libmace_processor.dylib',
      _ => 'libmace_processor.so',
    };
    final asset = input.packageRoot.resolve(
      'bin/$platform-$architecture$runtime/$libraryName',
    );
    if (!File.fromUri(asset).existsSync()) {
      throw StateError('Missing bundled Mace processor: $asset');
    }
    output.dependencies.add(asset);
    output.assets.code.add(
      CodeAsset(
        package: input.packageName,
        name: 'mace_dart.dart',
        linkMode: DynamicLoadingBundled(),
        file: asset,
      ),
    );
  });
}
