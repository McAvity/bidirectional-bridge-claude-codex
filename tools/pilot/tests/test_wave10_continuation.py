"""Continuation evidence and launch-contract checks, without models."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/'wave10'))
import continuation as C

class ContinuationTests(unittest.TestCase):
    def manifest(self):
        return {'original_run':'/tmp/synthetic-retained-pilot','baseline':{'pairs':{
            p:{'binding':{'native_thread_id':f'synthetic-{p}-exact-thread'}} for p in ('a','b')}}}

    def test_all_manager_launches_resume_exact_existing_threads(self):
        for role,pair in [('a-initial','a'),('b-initial','b'),('a-restart','a')]:
            cmd=C.command(Path('/tmp/synthetic-continuation'),self.manifest(),role)
            self.assertEqual(cmd[-2:],['resume',f'synthetic-{pair}-exact-thread'])
            self.assertNotIn('--last',cmd)
            self.assertIn('/tmp/synthetic-retained-pilot/'+pair,cmd)
            self.assertIn('--no-alt-screen',cmd)

    def test_all_timeout_layers_are_scoped_to_continuation(self):
        cmd=C.command(Path('/tmp/synthetic-cont'),self.manifest(),'a-initial')
        self.assertIn('mcp_servers.bridge.tool_timeout_sec=3300',cmd)
        self.assertIn('mcp_servers.bridge.startup_timeout_sec=1200',cmd)
        self.assertIn('mcp_servers.bridge.env.BASH_MAX_TIMEOUT_MS="1800000"',cmd)
        self.assertIn('mcp_servers.bridge.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS="1"',cmd)
        import tomllib
        for i,arg in enumerate(cmd):
            if arg=='-c': tomllib.loads(cmd[i+1])
        self.assertEqual(C.BUDGET['a_r2_ms'],2700000)
        self.assertEqual(C.BUDGET['b_r2_ms'],2700000)
        self.assertEqual(C.BUDGET['wall_minutes'],90)

    def test_foreign_is_new_denied_delegate_and_has_no_impersonation(self):
        cmd=C.command(Path('/tmp/synthetic-continuation'),self.manifest(),'foreign')
        self.assertNotIn('resume',cmd)
        self.assertTrue(any('"deny"' in x for x in cmd))
        self.assertFalse(any('synthetic-a-exact-thread' in x for x in cmd))

    def test_no_arbitrary_launch_role(self):
        with self.assertRaises(ValueError): C.command(Path('/tmp/x'),self.manifest(),'new-a')

    def test_no_overwrite_retained_or_continuation_directory(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(C,'audit') as audit:
                with self.assertRaisesRegex(ValueError,'new continuation directory'): C.prepare(Path('/tmp/old'),Path(d))
                audit.assert_not_called()

    def test_waiting_requires_unanswered_exact_question_and_no_worker(self):
        s={'feature':{'feature_id':'F-W10-pair','state':'waiting_user','question':{'id':'q1','text':'Which suffix should round 2 use?','answer':None},'active_task_id':None},'attempts':[{'ended_at':1}]}
        self.assertTrue(C.waiting(s))
        s['feature']['question']['answer']='synthetic answer';self.assertFalse(C.waiting(s))
        s['feature']['question']['answer']=None;s['attempts'][0]['ended_at']=None;self.assertFalse(C.waiting(s))

    def test_budget_keeps_gate_round_mcp_and_final_evidence_margin(self):
        b=C.BUDGET
        self.assertLess(b['operator_seconds'],b['gate_seconds'])
        self.assertLess(b['gate_seconds']*1000,b['gate_bash_ms'])
        self.assertLess(b['gate_bash_ms'],b['b_r2_ms'])
        self.assertEqual(b['claude_max_turns_per_invocation'],32)
        self.assertTrue(b['astra_turns_are_planning_only'])
        self.assertLess(b['b_r2_ms'],b['mcp_seconds']*1000)
        self.assertLessEqual(b['latest_b_r2_start_minutes']*60+b['b_r2_ms']/1000+300,b['wall_minutes']*60)
        self.assertEqual(b['claude_rounds'],2)

    def test_successful_message_count_is_not_executor_limit(self):
        state={'binding':{'native_thread_id':'synthetic-a','epoch':1},
               'attempts':[{'execution_handle':'synthetic-claude','outcome':'COMPLETE'}],
               'telemetry':{'num_turns':18}, 'spec':{'max_turns':12}}
        C.check_worker_state(state,state)
        state['attempts'][0]['outcome']='FAILED'
        with self.assertRaisesRegex(ValueError,'failed'):C.check_worker_state(state,state)

    def test_changed_claude_handle_stops_continuation(self):
        original={'binding':{'native_thread_id':'synthetic-a','epoch':1},
                  'attempts':[{'execution_handle':'original','outcome':'COMPLETE'}]}
        state={**original,'attempts':original['attempts']+[{'execution_handle':'replacement','outcome':None}]}
        with self.assertRaisesRegex(ValueError,'Claude session changed'):C.check_worker_state(state,original)

    def test_prepare_uses_multiline_prompts_for_the_verified_paste_path(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'old';root.mkdir();out=Path(d)/'continuation'
            for name in ['ROUND2-A.txt','ROUND2-B.txt','RESUME-A.txt','FOREIGN.txt']:
                (root/name).write_text('Synthetic one-line prompt')
            with patch.object(C,'audit',return_value={'retained':'unchanged'}),patch.object(C.pilot,'git',return_value='synthetic-sha'):
                C.prepare(root,out)
            for name in json.loads((out/'manifest.json').read_text())['prompt_sha256']:
                self.assertIn('\n',(out/name).read_text(),name)
            self.assertFalse((out/'approval.json').exists())
            self.assertIn(' + 1500',(root/'b/.pilot/gate-continuation-v2.py').read_text())

    def test_old_approval_cannot_authorize_continuation(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);(out/'manifest.json').write_text('{}')
            (out/'approval.json').write_text(json.dumps({'approved':True,'scope':'wave10-two-pairs-v2'}))
            # No Client construction occurs before the continuation approval check.
            try: import tui_operator
            except ModuleNotFoundError: self.skipTest('optional PTY dependencies absent')
            with patch.object(C,'preflight',return_value=self.manifest()),patch.object(tui_operator,'Client') as client:
                with self.assertRaisesRegex(ValueError,'continuation approval'):C.serve(out)
                client.assert_not_called()

if __name__=='__main__':unittest.main()
