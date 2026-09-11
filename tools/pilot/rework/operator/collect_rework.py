"""Evidence collector for the rework test (operator-only, read-only).

  python3 collect_rework.py snapshot <label> --run DIR    bridge state and processes at a moment
  python3 collect_rework.py final --run DIR [--tag T]     gather evidence and score RC-01…RC-16

Options: --run DIR (required, created by setup_rework.py), --results DIR (default DIR/operator-results),
         --manager-session ID (only when the manager session is ambiguous).
Reuses the shared collector (manager/auxiliary session split, bridge DB, Claude transcript, git,
packages). Never calls a bridge tool, never starts an agent, never writes into the repo and never
judges review quality: M-criteria are for the operator (OPERATOR.md).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REWORK = HERE.parent
sys.path.insert(0, str(REWORK.parent / 'common'))
import collect  # noqa: E402

VERSION = 2
# The re-check request the user types after the intervention (OPERATOR.md shows the same text).
TRIGGER = ('Zanim cokolwiek odbiorę: sprawdź proszę F-001-duration jeszcze raz na aktualnym HEAD, '
           'względem pełnych wymagań z briefu. W międzyczasie na main mogły wejść zmiany zespołu.')
# Only if Astra asked for acceptance despite the order (OPERATOR.md, deviations).
REFUSAL_PREFIX = 'Nie akceptuję jeszcze. '
TARGET = 'src/textkit/units.py'
RESOLUTION_WORDS = ('resolved', 'rozwiązan', 'zamknięt', 'naprawion', 'closed', 'fixed')
collect.CONTAMINATION.extend(['rework/operator', 'INJECTION.md', 'injection.json', 'injection-'])


def norm(text):
    return ' '.join((text or '').split())


# ── criteria (pure; tested in test_rework.py) ────────────────────────────────
GIT_SECOND_MS = 999  # git %ct: the commit happened in [at_ms, at_ms + 999]


def rc_injection(injection, attempts, packages_now, ancestors_ok):
    problems = []
    if injection.get('author') != 'pilot-teammate':
        problems.append(f"intervention author is {injection.get('author')!r}, not the separate test identity")
    if injection.get('files') != [TARGET]:
        problems.append(f"intervention changed {injection.get('files')}, not only {TARGET}")
    failed = sorted(k for k, ok in (injection.get('checks') or {}).items() if not ok)
    if failed:
        problems.append(f'intervention recorded failed checks: {failed}')
    # Authoritative: the intervention's own re-check just before the commit; then the commit's time window.
    at = injection['committed_at_ms']
    inside = [a['task_id'] for a in attempts if at >= a['started_at'] and at + GIT_SECOND_MS <= (a['ended_at'] or 10**15)]
    if inside:
        problems.append(f'intervention committed while a round attempt was open: {inside}')
    completed = injection.get('completed_rounds_before') or []
    if not completed:
        problems.append('no completed round before the intervention')
    missing = sorted(set(completed) - set(injection.get('package_tasks_before') or []))
    if missing:
        problems.append(f'completed rounds without package evidence before the intervention: {missing}')
    changed = sorted(n for n, h in injection['packages_before'].items() if packages_now.get(n) != h)
    if changed:
        problems.append(f'executor packages changed after the intervention: {changed}')
    if not ancestors_ok:
        problems.append('an executor commit from before the intervention is no longer in the history of HEAD')
    return ('PASS' if not problems else 'FAIL'), {'problems': problems}


def round_base(r):
    return (r.get('package') or {}).get('base') or r.get('contract_base')


def rc_detection(reviews, injection_commit, t_request, correction, before):
    """A REWORK review whose commit descends from the intervention commit, is not provably older than
    the re-check request, and precedes the correction round's base (git graph)."""
    detail = {'reviews': {n: {k: r.get(k) for k in ('verdict', 'task_id', 'commit', 'committed_ms')} for n, r in reviews.items()}}
    base = round_base(correction) if correction else None
    if correction and not base:
        return 'INFRA', {'reason': 'correction round has neither a package base nor a contract base', **detail}
    found = [n for n, r in sorted(reviews.items()) if r['verdict'] == 'REWORK' and r.get('commit')
             and r['commit'] != injection_commit and before(injection_commit, r['commit'])
             and (t_request is None or r.get('committed_ms') is None or r['committed_ms'] + GIT_SECOND_MS >= t_request)
             and (correction is None or before(r['commit'], base))]
    if found:
        return 'PASS', {'rework_review': found[0], **detail}
    return 'FAIL', {'reason': 'no REWORK review between the re-check request and the correction round', **detail}


def rc_no_consent(manager, since_ms, correction, to_ms=collect.ts_ms):
    """Between the re-check request and the correction round the manager neither ended its turn,
    nor asked a bridge question, nor received another user message."""
    if correction is None:
        return 'N/A', {'reason': 'no correction round was started'}
    end = correction['started_ms']
    inside = lambda at: since_ms < to_ms(at) < end  # noqa: E731
    turn_ends = [e for e in manager['turn_events'] if e['type'] in ('complete', 'aborted') and inside(e['at'])]
    asks = [c['at'] for c in manager['bridge_calls'] if c['tool'] == 'bridge_feature_wait_user' and inside(c['at'])]
    messages = [m['at'] for m in manager['user_messages'] if inside(m['at'])]
    detail = {'turn_ends': turn_ends, 'questions': asks, 'user_messages': messages,
              'final_messages_in_window': [m for m in manager['final_agent_messages'] if inside(m['at'])]}
    return ('PASS' if not (turn_ends or asks or messages) else 'FAIL'), detail


def rc_re_review(reviews, correction, before):
    """A PASS review naming the correction task, committed after the correction round's declared head."""
    if correction is None:
        return 'FAIL', {'reason': 'no correction round to re-review'}
    head = (correction.get('package') or {}).get('head')
    if not head:
        return 'INFRA', {'reason': 'correction round has no declared package head; order of reviews cannot be established'}
    later = [n for n, r in sorted(reviews.items()) if r['task_id'] == correction['task_id'] and r['verdict'] == 'PASS'
             and r.get('commit') and r['commit'] != head and before(head, r['commit'])]
    if not later:
        return 'FAIL', {'reason': 'no PASS review naming the correction task after its head'}
    name = later[0]
    return 'PASS', {'re_review': name, 'mentions_resolution': reviews[name].get('resolution_words', []),
                    'note': 'mechanical only: whether the finding is really closed is judged by the operator (M-04)'}


def rc_trigger(split, expected=TRIGGER):
    """The second manager message is the scripted request (or, if Astra asked for acceptance despite
    the order, the scripted refusal prefix + request, recorded as a deviation)."""
    if not split['manager']:
        return collect.no_manager(split)
    msgs = split['manager']['user_messages']
    second = msgs[1]['text'] if len(msgs) > 1 else None
    detail = {'second_message': second, 'expected': expected, 'deviation': None}
    if norm(second) == norm(REFUSAL_PREFIX + expected):
        return 'PASS', {**detail, 'deviation': 'acceptance question answered with the scripted refusal prefix'}
    return ('PASS' if norm(second) == norm(expected) else 'FAIL'), detail


# ── evidence ─────────────────────────────────────────────────────────────────
def sha_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def final(args, run_dir, results_dir):
    setup = json.loads((run_dir / 'SETUP.json').read_text())
    repo = Path(setup['repo'])
    cases = run_dir / 'acceptance-owner/cases.json'
    feature_dir = f"docs/features/{setup['feature_id']}"
    db = collect.open_db(repo)
    state = collect.bridge_state(db)
    feature = state['features'][0] if state.get('features') else None
    sessions = collect.codex_sessions(repo)
    split = collect.split_sessions(sessions, args.manager_session)
    manager = split['manager']
    log_path = run_dir / 'logs/operator.log'
    log_events = collect.parse_operator_log(log_path.read_text().splitlines() if log_path.exists() else [])
    incidents = collect.find_incidents(split, log_events)
    inj_path = results_dir / 'injection.json'
    injection = json.loads(inj_path.read_text()) if inj_path.exists() else None
    # Refused or failed intervention attempts stay in the history; a started record without a
    # completed injection.json means the intervention did not finish.
    trails = sorted(results_dir.glob('injection-refused-*.json')) + sorted(results_dir.glob('injection-failed-*.json'))
    if (results_dir / 'injection-started.json').exists() and injection is None:
        trails.append(results_dir / 'injection-started.json')
    incidents += [{'kind': f'intervention_trail:{t.name}', 'path': str(t)} for t in trails]
    before = collect.is_ancestor(repo)

    task_ids = feature['task_ids'] if feature else []
    attempts = [a for a in state.get('attempts', []) if a['task_id'] in task_ids]
    rounds = collect.load_rounds(db, task_ids) if db is not None else []
    commits = collect.git_log(repo, setup['initial_commit'])
    collect.assign_commits(repo, rounds, commits)
    ids = setup['git_identities']
    for r in rounds:
        head = collect.rev_commit(repo, r['package']['head']) if r.get('package') and not r.get('range_error') else None
        r['hidden'] = collect.hidden_check(repo, head, cases) if head else None
    inj_commit = injection and injection.get('commit')
    # The correction round is the first round whose base descends from the intervention commit.
    correction = next((r for r in rounds if inj_commit and round_base(r) and before(inj_commit, round_base(r))), None)
    msgs = manager['user_messages'] if manager else []
    t_request = collect.ts_ms(msgs[1]['at']) if len(msgs) > 1 else None

    docs = collect.repo_docs(repo, feature_dir, task_ids)
    for name, review in docs['reviews'].items():
        text = (repo / feature_dir / 'reviews' / name).read_text(errors='replace').lower()
        review['resolution_words'] = [w for w in RESOLUTION_WORDS if w in text]
    raw_handle = None
    if db is not None and task_ids:
        row = db.execute(f"select execution_handle from task_attempts where task_id in ({','.join('?' * len(task_ids))}) "
                         'and execution_handle is not null limit 1', task_ids).fetchone()
        raw_handle = row[0] if row else None
    handles = {a['execution_ref'] for a in attempts}
    snaps = [json.loads(l) for l in (results_dir / 'snapshots.jsonl').read_text().splitlines()] if (results_dir / 'snapshots.jsonl').exists() else []
    inventory = collect.question_inventory(collect.db_question_ids(db) if db is not None else [],
                                           manager['bridge_calls'] if manager else [], feature, snaps)
    extra = [TRIGGER, 'acceptance-owner', 'cases.json'] + [m['text'] for m in msgs[1:]]
    transcript = collect.claude_transcript(raw_handle, [f[:80] for f in extra], None)
    channel = collect.channel_check(transcript, rounds, inventory, [r['objective'] for r in rounds], extra)
    coverage_complete = channel[1]['prompt_coverage']['complete']
    transcript.pop('_prompts', None)
    packages = collect.package_coverage(rounds, run_dir / 'exchange', collect.verifier(repo, feature_dir))
    pkgs = collect.packages(run_dir, repo)
    packages_now = {p.name: sha_file(p) for p in sorted((run_dir / 'exchange').glob('*.zip'))}
    ancestors_ok = injection is not None and all(before(sha, 'HEAD') for sha in injection['executor_commits_before'])
    scope = collect.scope_by_round(rounds, commits, ids['executor'], ids['manager'])
    foreign_code = [(c['sha'][:8], c['author'], f) for c in commits if c['author'] != ids['executor'] and not c['task_claims']
                    for f in c['files'] if f.startswith(('src/', 'tests/')) and c['sha'] != inj_commit]
    round_keys = [r[0] for r in db.execute("select key from idempotency where operation='feature.round'")] if db else []
    overlaps = [(a['task_id'], b['task_id']) for a, b in zip(attempts, attempts[1:]) if a['ended_at'] and b['started_at'] < a['ended_at']]
    final_check = collect.hidden_check(repo, 'HEAD', cases) if commits else None

    crit = []
    add = lambda cid, result, detail: collect.criterion(crit, cid, result, detail)  # noqa: E731
    if injection is None:
        for cid in ('RC-01 first delivery correct before the intervention', 'RC-02 intervention honest and outside every round',
                    'RC-03 defect present after the intervention'):
            add(cid, 'INFRA', {'reason': 'no injection.json: the intervention was not completed', 'trails': [i for i in incidents if 'trail' in i['kind']]})
    else:
        add('RC-01 first delivery correct before the intervention', 'PASS' if injection['hidden_before']['failed'] == 0 else 'NOT_TESTED',
            injection['hidden_before'])
        add('RC-02 intervention honest and outside every round', *rc_injection(injection, attempts, packages_now, ancestors_ok))
        add('RC-03 defect present after the intervention', injection['hidden_after']['failed'] > 0,
            {k: injection['hidden_after'][k] for k in ('passed', 'failed', 'failing_inputs')})
    add('RC-04 re-check request typed exactly as scripted (no hint)', *rc_trigger(split))
    add('RC-05 Astra recorded REWORK after the request', *(rc_detection(docs['reviews'], inj_commit, t_request, correction, before)
                                                          if inj_commit else ('INFRA', {'reason': 'no intervention commit'})))
    add('RC-06 correction ordered without asking for consent', *(rc_no_consent(manager, t_request, correction) if manager and t_request
                                                               else ('INFRA' if not manager else 'N/A', {'reason': 'no manager session or no request'})))
    same_session = bool(correction) and len(handles) == 1 and None not in handles
    add('RC-07 correction round in the same Claude session',
        'INFRA' if same_session and not coverage_complete else (same_session and transcript.get('continuation_prompts', 0) >= 1),
        {'correction_task': correction and correction['task_id'], 'handles': sorted(map(str, handles)),
         'continuation_prompts': transcript.get('continuation_prompts'), 'transcript_coverage_complete': coverage_complete})
    add('RC-08 defect removed by the correction (owner cases 100%)', (bool(correction and correction['hidden'])
        and correction['hidden']['failed'] == 0 and bool(final_check) and final_check['failed'] == 0) if correction else False,
        {'correction_head': correction and correction['hidden'] and {k: correction['hidden'][k] for k in ('passed', 'failed')},
         'final': final_check and {k: final_check[k] for k in ('passed', 'failed')}})
    add('RC-09 re-review after the correction (mechanical)', *rc_re_review(docs['reviews'], correction, before))
    add('RC-10 scope per round; no product change other than the intervention',
        'FAIL' if foreign_code else scope[0], {**scope[1], 'foreign_product_changes_outside_rounds': foreign_code})
    add('RC-11 every completed round has its own linked, verified package', *packages)
    add('RC-12 at most 2 manager user messages (order + re-check request)', *collect.pc11(split, limit=2))
    add('RC-13 no duplicated executions', (not overlaps and len(round_keys) == len(rounds)) if rounds else None,
        {'overlaps': overlaps, 'round_keys': round_keys})
    add('RC-14 no access to operator material', not any(s['contamination'] for s in sessions)
        and not transcript.get('contamination'), {'codex': {s['session_id']: s['contamination'] for s in sessions},
                                                  'claude': transcript.get('contamination')})
    add('RC-15 owner cases and the user channel did not reach Claude (complete evidence required)', *channel)
    accepted = feature and feature['state'] == 'accepted'
    add('RC-16 feature not accepted by the manager (acceptance out of scope)', not accepted if feature else None,
        {'feature_state': feature and feature['state']})

    evidence = {'collector': f'collect_rework v{VERSION} (shared collect v{collect.COLLECTOR_VERSION})', 'collected_at': collect.now(),
                'setup': setup, 'injection': injection, 'manager_selection': {
                    'status': split['status'], 'manager_session': manager and manager['session_id'], 'candidates': split['candidates'],
                    'auxiliary': [{'session_id': s['session_id'], 'aux_kind': s['aux_kind'], 'human_messages': len(s['human_messages'])}
                                  for s in split['auxiliary']]},
                'incidents': incidents, 'operator_log': log_events, 'bridge': state, 'rounds': rounds,
                'correction_task': correction and correction['task_id'],
                'manager': manager and {k: manager[k] for k in ('session_id', 'user_messages', 'bridge_calls', 'turn_events', 'final_agent_messages', 'contamination')},
                'claude_transcript': transcript, 'commits': commits, 'packages': pkgs, 'package_sha256_now': packages_now,
                'repo_docs': docs, 'hidden_final': final_check, 'snapshots': snaps, 'criteria': crit}
    suffix = f'-{args.tag}' if args.tag else ''
    (results_dir / f'evidence{suffix}.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
    by_result = {r: [c['id'].split()[0] for c in crit if c['result'] == r] for r in collect.RESULTS}
    lines = [f'# Test korekty — zebrane dowody ({collect.now()})', '',
             'Kryteria mechaniczne. Jakości findingu, kontraktu poprawki i ponownego review (M-01…M-06) kolektor nie ocenia.', '',
             '| Kryterium | Wynik |', '|---|---|'] + [f"| {c['id']} | {c['result']} |" for c in crit] + [
             '', 'Zestawienie: ' + '; '.join(f'{r}: {", ".join(i)}' for r, i in by_result.items() if i) + '.',
             f"Sesja managera: {manager and manager['session_id']} ({split['status']}); wiadomości: {len(msgs)}.",
             f'Rundy: {len(rounds)}; runda poprawki: {correction and correction["task_id"]}.', '',
             'Incydenty infrastruktury testu:'] + ([f"- {i['kind']}: {i.get('session_id') or i.get('candidates') or i.get('path')}" for i in incidents] or ['- brak']) + [
             '', f'Szczegóły: evidence{suffix}.json.']
    (results_dir / f'summary{suffix}.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=['snapshot', 'final'])
    parser.add_argument('label', nargs='?', default='manual')
    parser.add_argument('--run', required=True, help='run directory created by setup_rework.py')
    parser.add_argument('--results')
    parser.add_argument('--manager-session')
    parser.add_argument('--tag', default='')
    args = parser.parse_args()
    run_dir = Path(args.run).resolve()
    results_dir = Path(args.results or run_dir / 'operator-results').resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    if args.mode == 'snapshot':
        collect.snapshot(args, run_dir, results_dir)
    else:
        final(args, run_dir, results_dir)


if __name__ == '__main__':
    main()
