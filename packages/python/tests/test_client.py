import os
import platform
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from mace_python import MaceError, import_json, json, json_text, output, parse, transform


def bundled_mace_path() -> str:
    targets = {
        ("darwin", "x86_64"): "darwin-amd64",
        ("darwin", "arm64"): "darwin-arm64",
        ("linux", "x86_64"): "linux-amd64",
        ("linux", "aarch64"): "linux-arm64",
        ("win32", "AMD64"): "windows-amd64",
        ("win32", "ARM64"): "windows-arm64",
    }
    target = targets[(sys.platform, platform.machine())]
    executable = "mace.exe" if sys.platform == "win32" else "mace"
    return str(Path(__file__).parents[1] / "src" / "mace_python" / "bin" / target / executable)


class ClientTest(unittest.TestCase):
    def test_passes_runtime_input_to_the_mace_cli(self) -> None:
        mace_path = os.environ.get("MACE_PATH")

        with tempfile.TemporaryDirectory(prefix="mace-python-test-") as directory:
            path = Path(directory) / "runtime.mace"
            path.write_text(
                """|===|
schema Runtime: { env: string, };
|===|
[output = 'data', parse = Runtime]
{
  env: $env,
}
""",
                encoding="utf-8",
            )

            completed = subprocess.run(
                [mace_path or bundled_mace_path(), "output", str(path)],
                capture_output=True,
                check=True,
                text=True,
            )
            print("Mace CLI runtime output:", completed.stdout.strip())

            if mace_path:
                result = json(str(path), input='{ env: "prod", }', mace_path=mace_path)
            else:
                result = json(str(path), input='{ env: "prod", }')

        self.assertEqual({"env": "prod"}, result)

    def test_transforms_every_value_operation_into_a_record(self) -> None:
        mace_path = os.environ.get("MACE_PATH")

        with tempfile.TemporaryDirectory(prefix="mace-python-test-") as directory:
            path = Path(directory) / "config.mace"
            path.write_text('{ name: "Mace", }', encoding="utf-8")

            self.assertEqual(
                {"name": "Mace", "total": 4},
                parse('|===|\nint base = 2 + 2;\n|===|\n{ name: "Mace", total: base, }'),
            )
            self.assertEqual({"name": "Mace"}, transform('{ name: "Mace", }', mace_path=mace_path))
            self.assertEqual({"name": "Mace"}, json_text(str(path), mace_path=mace_path))
            completed = subprocess.run(
                [mace_path or bundled_mace_path(), "output", str(path)],
                capture_output=True,
                check=True,
                text=True,
            )
            print("Mace CLI output:", completed.stdout.strip())

            output_record = output(str(path), mace_path=mace_path)
            print("Mace parsed output:", output_record)
            self.assertEqual({"name": "Mace"}, output_record)
            self.assertEqual({"name": "Mace"}, import_json('{"name":"Mace"}', mace_path=mace_path))

    def test_exposes_a_diagnostic_when_mace_rejects_source(self) -> None:
        mace_path = os.environ.get("MACE_PATH")

        with tempfile.TemporaryDirectory(prefix="mace-python-test-") as directory:
            path = Path(directory) / "invalid.mace"
            path.write_text("{ nope: }", encoding="utf-8")

            with self.assertRaises(MaceError) as raised:
                json(str(path), mace_path=mace_path)

        error = raised.exception
        self.assertEqual('parser: expected expression at 1:9 near "}"', str(error))
        self.assertEqual("parser", error.diagnostic.category)
        self.assertEqual('expected expression at 1:9 near "}"', error.diagnostic.message)
        self.assertIsNotNone(error.diagnostic.range)
        self.assertEqual(1, error.diagnostic.range.start.line)
        self.assertEqual(9, error.diagnostic.range.start.column)
        self.assertEqual(str(path), error.diagnostic.path)


if __name__ == "__main__":
    unittest.main()
