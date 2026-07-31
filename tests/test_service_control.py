import os
import unittest
from unittest.mock import patch

from service_control import RESTART_EXIT_CODE, ServiceRestartController


class FakeLoop:
    def __init__(self):
        self.calls = []

    def call_later(self, delay, callback, *args):
        self.calls.append((delay, callback, args))


class ServiceRestartControllerTest(unittest.TestCase):
    def test_schedule_uses_restart_exit_code_once(self):
        exit_calls = []
        controller = ServiceRestartController(
            exit_process=lambda code: exit_calls.append(code),
        )
        loop = FakeLoop()

        self.assertTrue(controller.schedule(loop))
        self.assertFalse(controller.schedule(loop))
        self.assertEqual(len(loop.calls), 1)

        delay, callback, args = loop.calls[0]
        self.assertEqual(delay, 0.75)
        callback(*args)
        self.assertEqual(exit_calls, [RESTART_EXIT_CODE])

    def test_supported_requires_systemd_invocation(self):
        controller = ServiceRestartController()
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(controller.supported)
        with patch.dict(os.environ, {"INVOCATION_ID": "test"}, clear=True):
            self.assertEqual(controller.supported, os.name != "nt")


if __name__ == "__main__":
    unittest.main()
