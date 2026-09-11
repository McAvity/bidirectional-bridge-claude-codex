"""Tests for the rework-test collector criteria and the intervention (operator-only).
Run: python3 -m unittest discover -s tools/pilot/tests -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PILOT = HERE.parent
sys.path.insert(0, str(PILOT / 'common'))
sys.path.insert(0, str(PILOT / 'rework/operator'))
sys.path.insert(0, str(HERE))
import collect  # noqa: E402
import test_collect as tc  # noqa: E402  (real rollout writer)
import collect_rework as cr  # noqa: E402
import regressions  # noqa: E402

MIN = 60_000
T_INJ = 10 * MIN
T_MSG2 = 12 * MIN


def iso(ms):
    return collect.ms_to_iso(ms + 1_788_000_000_000).replace('+00:00', 'Z')


def ms(value):
    return collect.ts_ms(value) - 1_788_000_000_000


R1 = {'task_id': 't1', 'started_ms': 1 * MIN, 'ended_ms': 4 * MIN}
R2 = {'task_id': 't2', 'started_ms': 15 * MIN, 'ended_ms': 18 * MIN}


class Injection(unittest.TestCase):
    INJ = {'author': 'pilot-teammate', 'files': ['src/textkit/units.py'], 'committed_at_ms': T_INJ,
           'packages_before': {'r01.zip': 'aaa'}, 'completed_rounds_before': ['t1'], 'package_tasks_before': ['t1'],
           'checks': {'worktree clean': True, 'no open attempt': True}}
    ATTEMPTS = [{'task_id': 't1', 'started_at': 1 * MIN, 'ended_at': 4 * MIN}]

    def test_clean_intervention_passes(self):
        self.assertEqual(cr.rc_injection(self.INJ, self.ATTEMPTS, {'r01.zip': 'aaa'}, True)[0], 'PASS')

    def test_empty_package_evidence_fails(self):
        inj = dict(self.INJ, packages_before={}, package_tasks_before=[])
        result, detail = cr.rc_injection(inj, self.ATTEMPTS, {}, True)
        self.assertEqual(result, 'FAIL')
        self.assertIn('completed rounds without package evidence before the intervention: [\'t1\']', detail['problems'])

    def test_failed_recorded_check_fails(self):
        inj = dict(self.INJ, checks={'worktree clean': False})
        self.assertEqual(cr.rc_injection(inj, self.ATTEMPTS, {'r01.zip': 'aaa'}, True)[0], 'FAIL')

    def test_intervention_refused_by_its_own_open_attempt_check_fails(self):
        inj = dict(self.INJ, checks={'no open attempt': False})
        self.assertEqual(cr.rc_injection(inj, self.ATTEMPTS, {'r01.zip': 'aaa'}, True)[0], 'FAIL')

    def test_intervention_inside_a_round_fails(self):
        inj = dict(self.INJ, committed_at_ms=2 * MIN)
        self.assertEqual(cr.rc_injection(inj, self.ATTEMPTS, {'r01.zip': 'aaa'}, True)[0], 'FAIL')

    def test_changed_executor_package_fails(self):
        self.assertEqual(cr.rc_injection(self.INJ, self.ATTEMPTS, {'r01.zip': 'bbb'}, True)[0], 'FAIL')

    def test_rewritten_executor_history_fails(self):
        self.assertEqual(cr.rc_injection(self.INJ, self.ATTEMPTS, {'r01.zip': 'aaa'}, False)[0], 'FAIL')

    def test_agent_identity_or_extra_files_fail(self):
        self.assertEqual(cr.rc_injection(dict(self.INJ, author='claude-executor'), self.ATTEMPTS, {'r01.zip': 'aaa'}, True)[0], 'FAIL')
        self.assertEqual(cr.rc_injection(dict(self.INJ, files=['src/textkit/units.py', 'src/textkit/duration.py']),
                                         self.ATTEMPTS, {'r01.zip': 'aaa'}, True)[0], 'FAIL')


class Detection(unittest.TestCase):
    ORDER = ['r1head', 'rev01', 'inj', 'rev02', 'c_base', 'c_head', 'rev03']

    def before(self, a, b):
        return a in self.ORDER and b in self.ORDER and self.ORDER.index(a) <= self.ORDER.index(b)

    CORR = {'task_id': 't2', 'started_ms': 15 * MIN, 'package': {'base': 'c_base', 'head': 'c_head'}, 'contract_base': None}

    def test_rework_after_the_intervention_and_before_the_correction_base_passes(self):
        reviews = {'01.md': {'verdict': 'PASS', 'task_id': 't1', 'commit': 'rev01', 'committed_ms': 5 * MIN},
                   '02.md': {'verdict': 'REWORK', 'task_id': 't1', 'commit': 'rev02', 'committed_ms': 14 * MIN}}
        result, detail = cr.rc_detection(reviews, 'inj', T_MSG2, self.CORR, self.before)
        self.assertEqual((result, detail['rework_review']), ('PASS', '02.md'))

    def test_rework_in_the_same_second_as_the_request_counts(self):
        reviews = {'02.md': {'verdict': 'REWORK', 'task_id': 't1', 'commit': 'rev02', 'committed_ms': T_MSG2 - 121}}  # %ct floor
        self.assertEqual(cr.rc_detection(reviews, 'inj', T_MSG2, self.CORR, self.before)[0], 'PASS')

    def test_rework_before_the_intervention_does_not_count(self):
        reviews = {'01.md': {'verdict': 'REWORK', 'task_id': 't1', 'commit': 'rev01', 'committed_ms': 5 * MIN}}
        self.assertEqual(cr.rc_detection(reviews, 'inj', T_MSG2, self.CORR, self.before)[0], 'FAIL')

    def test_rework_after_the_correction_started_does_not_count(self):
        reviews = {'03.md': {'verdict': 'REWORK', 'task_id': 't2', 'commit': 'rev03', 'committed_ms': 20 * MIN}}
        self.assertEqual(cr.rc_detection(reviews, 'inj', T_MSG2, self.CORR, self.before)[0], 'FAIL')

    def test_no_rework_fails(self):
        reviews = {'01.md': {'verdict': 'PASS', 'task_id': 't1', 'commit': 'rev01', 'committed_ms': 5 * MIN}}
        self.assertEqual(cr.rc_detection(reviews, 'inj', T_MSG2, None, self.before)[0], 'FAIL')

    def test_re_review_after_the_correction_head_passes(self):
        reviews = {'03.md': {'verdict': 'PASS', 'task_id': 't2', 'commit': 'rev03', 'resolution_words': ['resolved']}}
        result, detail = cr.rc_re_review(reviews, self.CORR, self.before)
        self.assertEqual((result, detail['re_review']), ('PASS', '03.md'))

    def test_re_review_before_the_correction_head_does_not_count(self):
        reviews = {'02.md': {'verdict': 'PASS', 'task_id': 't2', 'commit': 'rev02', 'resolution_words': []}}
        self.assertEqual(cr.rc_re_review(reviews, self.CORR, self.before)[0], 'FAIL')

    def test_correction_without_package_cannot_be_re_reviewed(self):
        corr = dict(self.CORR, package=None)
        reviews = {'03.md': {'verdict': 'PASS', 'task_id': 't2', 'commit': 'rev03', 'resolution_words': []}}
        self.assertEqual(cr.rc_re_review(reviews, corr, self.before)[0], 'INFRA')


class ConsentAndReReview(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def manager(self, extra):
        records = [tc.user(iso(0), 'start'), tc.rec(iso(1), 'event_msg', {'type': 'task_started'}),
                   tc.rec(iso(6 * MIN), 'event_msg', {'type': 'task_complete', 'last_agent_message': 'raport'}),
                   tc.user(iso(T_MSG2), 'sprawdź ponownie'), tc.rec(iso(T_MSG2 + 1), 'event_msg', {'type': 'task_started'})] + extra
        tc.write_session(self.tmp.name, 'manager', iso(0), 'cli', records)
        split = collect.split_sessions(collect.codex_sessions(tc.REPO, root=self.tmp.name))
        return split['manager']

    def test_correction_without_stopping_passes(self):
        self.assertEqual(cr.rc_no_consent(self.manager([]), T_MSG2 + 1, R2, ms)[0], 'PASS')

    def test_turn_end_before_correction_fails(self):
        mgr = self.manager([tc.rec(iso(13 * MIN), 'event_msg', {'type': 'task_complete', 'last_agent_message': 'Czy mogę poprawić?'})])
        result, detail = cr.rc_no_consent(mgr, T_MSG2 + 1, R2, ms)
        self.assertEqual(result, 'FAIL')
        self.assertEqual(len(detail['turn_ends']), 1)

    def test_question_before_correction_fails(self):
        mgr = self.manager([tc.exec_call(iso(13 * MIN), 'await tools.bridge_feature_wait_user({feature_id:"F",question_id:"q-01",question:"Zgoda?"});', 'c9')])
        self.assertEqual(cr.rc_no_consent(mgr, T_MSG2 + 1, R2, ms)[0], 'FAIL')

    def test_trigger_message_must_match_the_script(self):
        tc.write_session(self.tmp.name, 'manager', iso(0), 'cli', [tc.user(iso(0), 'start'), tc.user(iso(T_MSG2), 'Zanim  cokolwiek\nodbiorę: sprawdź.')])
        split = collect.split_sessions(collect.codex_sessions(tc.REPO, root=self.tmp.name))
        self.assertEqual(cr.rc_trigger(split, 'Zanim cokolwiek odbiorę: sprawdź.')[0], 'PASS')
        self.assertEqual(cr.rc_trigger(split, 'Zanim cokolwiek odbiorę: sprawdź units.py.')[0], 'FAIL')

    def test_trigger_after_an_acceptance_question_is_a_recorded_deviation(self):
        tc.write_session(self.tmp.name, 'manager', iso(0), 'cli', [tc.user(iso(0), 'start'), tc.user(iso(T_MSG2), 'Nie akceptuję jeszcze. ' + cr.TRIGGER)])
        split = collect.split_sessions(collect.codex_sessions(tc.REPO, root=self.tmp.name))
        result, detail = cr.rc_trigger(split)
        self.assertEqual((result, detail['deviation']), ('PASS', 'acceptance question answered with the scripted refusal prefix'))


class Intervention(unittest.TestCase):
    def test_only_to_seconds_changes(self):
        source = (PILOT / 'rework/agent/fixture/src/textkit/units.py').read_text()
        out = regressions.apply(source)
        self.assertIn('return int(float(value) * factor)', out)
        self.assertEqual(out.split('def to_seconds')[0], source.split('def to_seconds')[0])

    def test_not_applicable_without_the_function(self):
        with self.assertRaises(ValueError):
            regressions.apply('UNIT_SECONDS = {}\n\ndef other():\n    pass\n')


if __name__ == '__main__':
    unittest.main()
