import http.server
import tempfile
import threading
import time
import unittest
from pathlib import Path

from mace_python import CancellationToken, MaceError, json, json_text, output, transform


class ClientTest(unittest.TestCase):
    def test_evaluates_source_with_typed_nested_values(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            result = transform(
                "[output = 'data']\n{ name: 'Ada', score: 42, enabled: true, tags: ['a', 'b'], }",
                cwd=workspace,
            )
            self.assertEqual({"name": "Ada", "score": 42, "enabled": True, "tags": ["a", "b"]}, result)

    def test_evaluates_file_with_mace_input(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            path = Path(workspace) / "config.mace"
            path.write_text(
                "|===|\nschema Runtime: { env: string, };\n|===|\n"
                "[output = 'data', parse = Runtime]\n{ env: $env, }",
                encoding="utf-8",
            )
            self.assertEqual({"env": "prod"}, json(str(path), input='{ env: "prod", }', cwd=workspace))
            self.assertEqual({"env": "prod"}, json_text(str(path), input='{ env: "prod", }', cwd=workspace))

    def test_reports_structured_error(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            path = Path(workspace) / "invalid.mace"
            path.write_text("{ nope: }", encoding="utf-8")
            with self.assertRaises(MaceError) as raised:
                json(str(path), cwd=workspace)
            self.assertEqual("parser", raised.exception.diagnostic.category)
            self.assertEqual(1, raised.exception.diagnostic.range.start.line)
            self.assertEqual(str(path), raised.exception.diagnostic.path)

    def test_rejects_files_outside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as workspace, tempfile.TemporaryDirectory() as elsewhere:
            path = Path(elsewhere) / "config.mace"
            path.write_text("[output = 'data']\n{ enabled: true, }", encoding="utf-8")
            with self.assertRaisesRegex(MaceError, "workspace"):
                json(str(path), cwd=workspace)

    def test_cancelled_evaluation_reports_a_diagnostic(self) -> None:
        cancellation = CancellationToken()
        cancellation.cancel()
        with tempfile.TemporaryDirectory() as workspace:
            with self.assertRaises(MaceError) as raised:
                transform("[output = 'data']\n{ enabled: true, }", cwd=workspace, cancellation=cancellation)
        self.assertEqual("mace.runtime.cancelled", raised.exception.diagnostic.code)

    def test_timed_out_evaluation_reports_a_diagnostic(self) -> None:
        class Stalled(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                time.sleep(5)

            def log_message(self, *args: object) -> None:
                return

        server = http.server.HTTPServer(("127.0.0.1", 0), Stalled)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            source = f"|===|\nfrom 'http://127.0.0.1:{server.server_port}/types.mace' import Age;\n|===|\n[output = 'data']\n{{ age: 42, }}"
            with tempfile.TemporaryDirectory() as workspace:
                with self.assertRaises(MaceError) as raised:
                    transform(source, cwd=workspace, timeout_ms=100)
            self.assertEqual("mace.runtime.timeout", raised.exception.diagnostic.code)
        finally:
            server.shutdown()
            server.server_close()

    def test_deprecated_output_alias_still_evaluates_file(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            path = Path(workspace) / "config.mace"
            path.write_text("[output = 'data']\n{ enabled: true, }", encoding="utf-8")
            self.assertEqual({"enabled": True}, output(str(path), cwd=workspace))


if __name__ == "__main__":
    unittest.main()
