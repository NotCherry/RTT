"""Launcher regression checks without requiring a container runtime."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class LocalStartupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rtt startup ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "infra").mkdir()
        (self.root / "bin").mkdir()
        (self.root / "start-local.sh").write_bytes((ROOT / "start-local.sh").read_bytes())
        for name in ("docker-compose.yml", "docker-compose.dev.yml", "docker-compose.robot.yml"):
            (self.root / "infra" / name).write_bytes((ROOT / "infra" / name).read_bytes())
        self.log = self.root / "calls"
        self.env = {
            **os.environ,
            "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}",
            "CALL_LOG": str(self.log),
            "SERVICE_HEALTH": "healthy",
            "SERVICE_STATE": "running",
            "IMAGE_EXIT": "0",
            "BUILD_EXIT": "0",
        }
        self.write_command("podman", """case "$1" in
    info) exit 0 ;;
    image) exit "$IMAGE_EXIT" ;;
    ps) echo test-container ;;
    inspect)
        if [[ "$3" == '{{.State.Status}}' ]]; then
            echo "$SERVICE_STATE"
        else
            echo "$SERVICE_HEALTH"
        fi ;;
esac
""")
        self.write_command("podman-compose", """printf '%s\\n' "$*" >> "$CALL_LOG"
test "$1" = -p && test "$2" = rtt && test "$3" = -f || exit 90
test "$(dirname "$4")" = "$PWD" && test -f "$4" || exit 91
if [[ "$5" == build ]]; then exit "$BUILD_EXIT"; fi
""")

    def write_command(self, name, body):
        path = self.root / "bin" / name
        path.write_text("#!/usr/bin/env bash\n" + body)
        path.chmod(0o755)

    def launch(self, *args):
        result = subprocess.run(
            ["bash", "./start-local.sh", *args],
            cwd=self.root, env=self.env, capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(list(self.root.glob(".podman-compose.*.yml")), [])
        calls = self.log.read_text().splitlines() if self.log.exists() else []
        return result, calls

    def test_cached_start_refreshes_images_and_containers_before_waiting_for_health(self):
        result, calls = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0].endswith(" build"))
        self.assertIn("up -d --no-build --force-recreate --remove-orphans", calls[1])
        self.assertIn("http://localhost:8080", result.stdout)

    def test_build_missing_images_or_explicit_build(self):
        for args, missing in (((), "1"), (("--build",), "0"), (("--dev",), "0")):
            with self.subTest(args=args, missing=missing):
                self.log.unlink(missing_ok=True)
                self.env["IMAGE_EXIT"] = missing
                result, calls = self.launch(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(calls[0].endswith(" build"))
                self.assertIn(" up ", calls[1])

    def test_build_failure_prevents_start(self):
        self.env["BUILD_EXIT"] = "125"
        result, calls = self.launch("--build")
        self.assertEqual(result.returncode, 125)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("is running", result.stdout)

    def test_status_and_down_do_not_build(self):
        for arg, command in (("--status", "ps"), ("--down", "down")):
            with self.subTest(arg=arg):
                self.log.unlink(missing_ok=True)
                result, calls = self.launch(arg)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(calls), 1)
                self.assertTrue(calls[0].endswith(f" {command}"))

    def test_failed_health_or_exited_service_reports_logs(self):
        for state, health in (("running", "unhealthy"), ("exited", "starting")):
            with self.subTest(state=state, health=health):
                self.log.unlink(missing_ok=True)
                self.env.update(SERVICE_STATE=state, SERVICE_HEALTH=health)
                result, calls = self.launch()
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("is running", result.stdout)
                self.assertTrue(calls[-1].endswith(" logs --tail=50 backend"))

    def test_dev_compose_preserves_root_relative_bind_mounts(self):
        self.write_command("podman-compose", """test -f "$4" || exit 91
cmp "$4" "$PWD/infra/docker-compose.dev.yml" || exit 92
""")
        result, _ = self.launch("--dev", "--status")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_base_images_do_not_require_short_name_registry_configuration(self):
        for file in ("apps/api/Dockerfile", "apps/web/Dockerfile", "apps/web/Dockerfile.dev"):
            stages = set()
            for line in (ROOT / file).read_text().splitlines():
                if line.startswith("FROM "):
                    with self.subTest(file=file, line=line):
                        fields = line.split()
                        self.assertTrue(fields[1].startswith("docker.io/library/") or fields[1] in stages)
                        if len(fields) >= 4 and fields[2].lower() == "as":
                            stages.add(fields[3])

    def test_dev_frontend_does_not_replace_normal_frontend_image(self):
        compose = (ROOT / "infra/docker-compose.dev.yml").read_text()
        self.assertIn("image: localhost/rtt_frontend_dev:latest", compose)


if __name__ == "__main__":
    unittest.main()
