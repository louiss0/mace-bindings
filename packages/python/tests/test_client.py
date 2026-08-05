import os
import tempfile
import unittest
from pathlib import Path

from mace_python import MaceError, import_json, json, json_text, output, transform


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

            self.assertEqual({"name": "Mace"}, transform('{ name: "Mace", }', mace_path=mace_path))
            self.assertEqual({"name": "Mace"}, json_text(str(path), mace_path=mace_path))
            self.assertEqual({"name": "Mace"}, output(str(path), mace_path=mace_path))
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
