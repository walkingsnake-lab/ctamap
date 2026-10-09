"""boardlib/crash.py: the crash code.py saves before reloading, and what
started the run, for the health report."""

import os
import sys
import traceback
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from boardlib import crash  # noqa: E402

# How CircuitPython formats one (from a board's serial log).
CP_TB = '''Traceback (most recent call last):
  File "code.py", line 24, in <module>
  File "boardlib/app.py", line 390, in run
  File "boardlib/app.py", line 262, in step
  File "boardlib/player.py", line 312, in quiet_ms
MemoryError: memory allocation failed, allocating 256 bytes
'''


class TestCrash(unittest.TestCase):
    def test_names_the_innermost_frame(self):
        self.assertEqual(crash.describe(MemoryError('x'), CP_TB), 'MemoryError:player:312:quiet_ms')

    def test_works_with_a_cpython_traceback(self):
        try:
            {}['rows']
        except KeyError as e:
            tb = ''.join(traceback.format_exception(type(e), e, e.__traceback__))
            d = crash.describe(e, tb)
        self.assertTrue(d.startswith('KeyError:test_crash:'), d)
        self.assertTrue(d.endswith(':test_works_with_a_cpython_traceback'), d)

    def test_without_a_traceback_it_is_just_the_type(self):
        self.assertEqual(crash.describe(MemoryError(), ''), 'MemoryError')

    def test_only_url_safe_characters_and_short(self):
        d = crash.describe(ValueError(), '  File "boardlib/x y.py", line 1, in <lambda>\n' + 'z' * 200)
        self.assertEqual(d, 'ValueError:x_y:1:_lambda_')
        long = crash.describe(MemoryError(), '  File "a.py", line 1, in ' + 'f' * 200)
        self.assertLessEqual(len(long), crash.MAX_LEN)

    def test_saved_once_and_taken_once(self):
        nvm = bytearray(b'\xff' * 128)  # fresh flash
        self.assertEqual(crash.take(nvm), '')
        self.assertEqual(nvm, bytearray(b'\xff' * 128), 'nothing written when nothing is saved')
        crash.save(MemoryError(), CP_TB, nvm)
        self.assertEqual(crash.take(nvm), 'MemoryError:player:312:quiet_ms')
        self.assertEqual(crash.take(nvm), '', 'reported for one run only')

    def test_never_raises(self):
        crash.save(MemoryError(), CP_TB, nvm=b'')  # read-only, too small
        self.assertEqual(crash.take(nvm=b''), '')


class TestStartReason(unittest.TestCase):
    def start(self, run_reason, reset_reason):
        sup = types.ModuleType('supervisor')
        sup.RunReason = types.SimpleNamespace(STARTUP=0, AUTO_RELOAD=1, SUPERVISOR_RELOAD=2, REPL_RELOAD=3)
        sup.runtime = types.SimpleNamespace(run_reason=getattr(sup.RunReason, run_reason))
        mc = types.ModuleType('microcontroller')
        mc.ResetReason = types.SimpleNamespace(POWER_ON=0, RESET_PIN=1, WATCHDOG=2, BROWNOUT=3, SOFTWARE=4)
        mc.cpu = types.SimpleNamespace(reset_reason=getattr(mc.ResetReason, reset_reason))
        sys.modules['supervisor'] = sup
        sys.modules['microcontroller'] = mc
        return crash.start_reason()

    def tearDown(self):
        sys.modules.pop('supervisor', None)
        sys.modules.pop('microcontroller', None)

    def test_reloads_and_resets(self):
        self.assertEqual(self.start('SUPERVISOR_RELOAD', 'POWER_ON'), 'SUPERVISOR_RELOAD')
        self.assertEqual(self.start('AUTO_RELOAD', 'POWER_ON'), 'AUTO_RELOAD')
        self.assertEqual(self.start('STARTUP', 'WATCHDOG'), 'WATCHDOG')
        self.assertEqual(self.start('STARTUP', 'BROWNOUT'), 'BROWNOUT')
        self.assertEqual(self.start('STARTUP', 'POWER_ON'), 'POWER_ON')

    def test_empty_off_the_board(self):
        self.assertEqual(crash.start_reason(), '')


if __name__ == '__main__':
    unittest.main()
