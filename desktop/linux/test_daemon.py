import importlib.util
import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("deep-focus-hosts-daemon.py")
SPEC = importlib.util.spec_from_file_location("deep_focus_hosts_daemon", MODULE_PATH)
daemon = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(daemon)


class HostsDaemonTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        daemon.HOSTS_PATH = root / "hosts"
        daemon.STATE_PATH = root / "state.json"
        daemon.DNSMASQ_CONFIG_PATH = root / "dnsmasq.conf"
        daemon.HOSTS_PATH.write_text("127.0.0.1 localhost\n", encoding="utf-8")
        daemon.state = {"endsAtMillis": 0, "domains": [], "allowedDomains": [], "ownerUid": None}

    def tearDown(self):
        self.temp.cleanup()

    def test_hosts_fallback_blocks_the_root_hostname(self):
        daemon.write_hosts(["example.com"])
        hosts = daemon.HOSTS_PATH.read_text(encoding="utf-8")
        self.assertIn("0.0.0.0 example.com", hosts)
        self.assertNotIn("www.example.com", hosts)

    def test_dnsmasq_policy_blocks_subdomains_and_forwards_allowed_subtree(self):
        config = daemon.build_dnsmasq_config(["example.com"], ["docs.example.com"], ["1.1.1.1"])
        self.assertIn(f"listen-address={daemon.DNS_ADDRESS}", config)
        self.assertIn("address=/example.com/#", config)
        self.assertIn("server=/docs.example.com/#", config)
        self.assertIn("server=1.1.1.1", config)
        daemon.DNSMASQ_CONFIG_PATH.write_text(config, encoding="utf-8")
        result = subprocess.run(
            [str(daemon.DNSMASQ_PATH), "--test", f"--conf-file={daemon.DNSMASQ_CONFIG_PATH}"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stderr)

    def test_activation_cannot_shorten_or_remove_an_active_block(self):
        first = int(time.time() * 1000) + 120_000
        with patch.object(daemon, "apply_policy"):
            daemon.activate({"endsAtMillis": first, "domains": ["one.example"], "allowedDomains": []}, 1000)
            daemon.activate({"endsAtMillis": first - 60_000, "domains": ["two.example"], "allowedDomains": []}, 1000)
        persisted = json.loads(daemon.STATE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(first, persisted["endsAtMillis"])
        self.assertEqual(["one.example", "two.example"], persisted["domains"])

    def test_activation_cannot_add_whitelist_exceptions_during_focus(self):
        deadline = int(time.time() * 1000) + 120_000
        with patch.object(daemon, "apply_policy"):
            daemon.activate({"endsAtMillis": deadline, "domains": ["example.com"], "allowedDomains": ["docs.example.com"]}, 1000)
            daemon.activate({"endsAtMillis": deadline, "domains": ["example.com"], "allowedDomains": ["docs.example.com", "new.example.com"]}, 1000)
        self.assertEqual(["docs.example.com"], daemon.state["allowedDomains"])

    def test_whitelist_must_be_inside_a_blocked_domain(self):
        deadline = int(time.time() * 1000) + 60_000
        with self.assertRaisesRegex(ValueError, "inside a blocked domain"):
            daemon.activate({"endsAtMillis": deadline, "domains": ["example.com"], "allowedDomains": ["outside.test"]}, 1000)


if __name__ == "__main__":
    unittest.main()
