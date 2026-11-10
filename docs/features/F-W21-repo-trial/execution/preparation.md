# Trial preparation

User execution request 2026-11-10 authorizes the committed W21-T01 scope,
one Claude worker, at most two dispatches in the same session and 20 minutes
from first dispatch to final receipt; local commits, no push/merge/publication.
Starting branch F-W21-test, HEAD b81b7c55dfbd5b810a96d8febfdb912eb2a6993a,
clean tracked/untracked status. Coordinator does not implement the fixture.

INSTRUCTIONS=bundle:1.1.0-2205a80f5109 IDENTITY=sha256:2205a80f5109effb2596b021a4dc7738c86a9803db6fe93071f4cbf170a386eb GENERATION=1

`npm run hcom:prepare` verified runtime 0.8.2 and workflow 1.1.0 without
configuration changes or a model. hcom 0.7.31, Claude 2.1.322, existing account
login confirmed; no account identifiers stored here. Stable default private
namespace is used, never a copied/reset state. Empty MCP/default permissions.

`npm ci --ignore-scripts` PASS (initial shell Node 25.6.1); build PASS.
Node 24.14.0 build PASS. TMPDIR=/private/tmp, Python 3.12 available.
Focused evidence suite on Node 25: 7 passed, 1 failed, expected 100001 stderr
bytes but got 65536. Node 24 focused suite: 8 passed. Direct Python subprocess
capture with Node 24, noresult, 99992 x characters plus TAIL-MARK: exit 3,
65536 bytes instead of 100001, missing tail. This independently reproduces the
fixture defect despite runner timing differences. Contract freezes a direct
exact-byte/tail/exit regression as well as the focused runner suite.

No full repository validation claimed. Next: dispatch bounded fixture correction,
independently review committed delivery, record correlated receipt and stop worker.
