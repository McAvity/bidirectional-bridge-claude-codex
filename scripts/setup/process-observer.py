"""Read-only Linux process observer. Invoked via system Python -I -S, never imports project code.

Only main requires root; observe is separately testable against synthetic procfs.
No argv, cwd targets or fd targets are returned. No files or processes are modified.
"""
import errno
import json
import os
import sys

GONE = (errno.ENOENT, errno.ESRCH)


def identity(base):
    with open(base + '/stat', encoding='utf-8') as f:
        raw = f.read()
    # comm can contain spaces and parentheses; starttime is field 22.
    fields = raw[raw.rindex(')') + 2:].split()
    return (os.stat(base).st_uid, fields[19])


def observe(root, uid, installer_pid, proc='/proc'):
    entries = []
    issues = []
    seen = {}
    own_pid = os.getpid()
    root = os.path.realpath(root)
    state = root + '/.bridge/'

    def snapshot():
        rows = {}
        for name in os.listdir(proc):
            if not name.isdigit() or int(name) in (own_pid, installer_pid):
                continue
            try:
                info = identity(proc + '/' + name)
                if info[0] == uid:
                    rows[int(name)] = info
            except OSError as error:
                if error.errno not in GONE:
                    raise
        return rows

    try:
        before = snapshot()
        for pid, initial in before.items():
            base = proc + '/' + str(pid)
            try:
                with open(base + '/cmdline', 'rb') as f:
                    argv = [os.fsdecode(x) for x in f.read().split(b'\0') if x]
                with open(base + '/comm', encoding='utf-8') as f:
                    comm = f.read().strip()
                # Zombies have no cwd/files; empty argv alone is NOT proof of exit.
                with open(base + '/stat', encoding='utf-8') as f:
                    stat = f.read()
                zombie = stat[stat.rindex(')') + 2:].split()[0] == 'Z'
                if zombie:
                    seen[pid] = initial
                    continue
                cwd = os.path.realpath(os.readlink(base + '/cwd'))
                kinds = []
                launchers = [i for i, arg in enumerate(argv) if os.path.basename(arg) == 'native-bridge-mcp.mjs']
                for index in launchers:
                    tail = argv[index + 1:]
                    workspace = cwd
                    if '--workspace' in tail:
                        flag = tail.index('--workspace')
                        if flag + 1 >= len(tail):
                            raise ValueError('incomplete workspace argument')
                        workspace = os.path.realpath(os.path.join(cwd, tail[flag + 1]))
                    if workspace == root:
                        kinds.append('bridge-mcp')
                        break
                if cwd == root and any(arg.endswith('/.bridge-project/entry.mjs') or arg == '.bridge-project/entry.mjs' for arg in argv):
                    if 'bridge-mcp' not in kinds:
                        kinds.append('bridge-mcp')
                client = comm in ('codex', 'claude') or (len(argv) > 1 and os.path.basename(argv[0]) == 'node' and os.path.basename(argv[1]) in ('codex', 'codex.js'))
                if cwd == root and client:
                    kinds.append('client')
                for fd in os.listdir(base + '/fd'):
                    try:
                        target = os.readlink(base + '/fd/' + fd)
                    except OSError as error:
                        if error.errno in GONE:
                            continue
                        raise
                    if target.startswith(state):
                        kinds.append('state-open')
                        break
                if identity(base) != initial:
                    issues.append({'pid': pid, 'code': 'PROCESS_CHANGED'})
                    continue
                seen[pid] = initial
                if kinds:
                    # Report fixed labels, not process-controlled strings (potential prompts).
                    entries.append({'pid': pid, 'kinds': kinds, 'command': 'process'})
            except OSError as error:
                if error.errno not in GONE:
                    issues.append({'pid': pid, 'code': errno.errorcode.get(error.errno, 'READ_ERROR')})
            except (ValueError, IndexError):
                issues.append({'pid': pid, 'code': 'INVALID_PROCESS_DATA'})
        after = snapshot()
        for pid, current in after.items():
            if seen.get(pid) != current:
                issues.append({'pid': pid, 'code': 'INCOMPLETE_OBSERVATION'})
        entries = [entry for entry in entries if after.get(entry['pid']) == before.get(entry['pid'])]
    except (OSError, ValueError, IndexError):
        issues.append({'code': 'SNAPSHOT_FAILED'})
    return {'supported': not issues, 'entries': sorted(entries, key=lambda entry: entry['pid']), 'unreadable': len(issues)}


def main():
    if len(sys.argv) != 5 or os.geteuid() != 0:
        return 1
    uid, installer_pid = int(sys.argv[1]), int(sys.argv[2])
    root, nonce = sys.argv[3:]
    if uid <= 0 or installer_pid <= 0 or not os.path.isabs(root) or len(nonce) != 32:
        return 1
    root = os.path.realpath(root)
    # A fresh scan, with a bounded retry for unrelated short-lived processes.
    for _ in range(3):
        result = observe(root, uid, installer_pid)
        if result['supported']:
            break
    result.update(format='bridge-process-observation/v1', uid=uid, installer_pid=installer_pid,
                  root=root, nonce=nonce, observer_euid=os.geteuid())
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # Never leak arbitrary procfs data or exception contents to the caller.
        sys.exit(1)
