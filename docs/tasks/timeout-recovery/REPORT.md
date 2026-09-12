# REPORT — timeout recovery, długie rundy, dowody zakończenia

Branch `timeout-recovery` (worktree osobny od aktywnych sesji), baza `aeb92c2`.
Plan: [PLAN.md](PLAN.md) · Kryteria: [ACCEPTANCE.md](ACCEPTANCE.md) ·
Procedura wdrożenia: [DEPLOY-AND-RESUME.md](DEPLOY-AND-RESUME.md) · Postęp: [PROGRESS.md](PROGRESS.md).

## Aktualność raportu

Poniższe wyniki i brak wdrożenia dotyczą historycznego zadania źródłowego.
Później koordynator zgłosił review, wdrożenie przypiętego `956b171` i recovery tej samej sesji.
Stan integracji, dowody i mapowanie oczyszczonych commitów: [wave9 progress](../../plans/wave9-progress.md).
Nie traktować dawnego „nie wykonano” jako obecnego statusu wave7.

## Przyczyna i zmiana zachowania

Runda W7-ID-01 została przerwana przez bridge po `deadline_ms = 900000`. Orchestrator kończył
próbę outcome `TIMEOUT` i przestawiał task na terminalny `FAILED`, a `assertRecoverable`
odrzucał `FAILED` — mimo zachowanego uchwytu sesji. Recovery `BLOCKED` nie przyjmowało też
jawnego deadline’u (domyślnie `spec.deadline_ms` lub 10 minut), a stderr runnera istniał tylko
w pamięci procesu i ginął na ścieżkach timeout/cancel.

Po zmianie: `FAILED` nadal jest terminalny, z jednym jawnym wyjątkiem —
`bridge_resume_delegated_task({recover_timeout: true, deadline_ms, max_turns?, idempotency_key})`
otwiera ponownie tylko taki task, dla którego trwałe zapisy dowodzą, że zatrzymał go deadline
bridge’a (patrz PLAN D2). Wznowienie zachowuje task ID, feature, właściciela, lineage, zakres i
natywną sesję; dodaje sąsiednią próbę z `resumed_from_attempt`; nie zmienia wyniku ani
telemetrii poprzedniej próby; zapisuje `FAILED → WORKING` z przyczyną `timeout_recovery`.
Dowody zakończenia (ograniczony stderr + metadane) trafiają do plików obok bazy, a w MCP
widoczne są tylko metadane.

## Commity (branch `timeout-recovery`)

| Commit | Zakres |
| --- | --- |
| `9c18d52` | plan, kryteria odbioru, PROGRESS |
| `569c48e` | recovery po timeout, budżety próby, dowody zakończenia, limit tur 256, testy |
| `4db266c` | konfiguracja 75/90, instrukcje obu ról, dokumentacja, procedura, raport |

| `956b171` | poprawiona procedura po review |

## Wyniki walidacji (w worktree zadania)

- `npm ci --ignore-scripts`, `npm run build` (tsc) — bez błędów.
- `npm test` — 379 testów / 25 plików PASS (baseline przed zmianą: 342 / 22).
- `python3 -m unittest discover -s tests` — 19 PASS.
- `python3 -m unittest discover -s tools/pilot/tests` — 110 PASS.
- `node docs/tools/check-doc-links.mjs` — PASS; `git diff --check` — czysto.
- Środowisko: Node 24.15.0, Python 3.12.3 (instrukcje repo podają przetestowany 3.11),
  Codex CLI 0.154.0, Claude Code 2.1.269.

Nowe testy: `shared/control-plane/src/timeout-recovery.test.ts` (20),
`shared/control-plane/src/evidence.test.ts` (6),
`claude/claude-side/src/adapters/claude-code-runner.evidence.test.ts` (8), test E2E w
`native-launcher.test.ts` (prawdziwy launcher stdio, atrapa `claude` na PATH, restart procesu
bridge’a), plus rozszerzenia testów narzędzi MCP i limitu tur. Wszystkie najpierw RED.

## Ograniczenia dowodowe

- Wszystkie testy używają atrapy wykonawcy (fixture stream-json) — nie są dowodem przebiegu z
  prawdziwym modelem. Nie uruchomiono żadnego płatnego modelu ani pilota wave6/wave7.
- Nie wykonano wdrożenia ani wznowienia `<task-id>`; aktywny runtime, bazy i worktree
  wave7 pozostały nietknięte.
- Weryfikacja klientów: z kodu (Codex 0.154.0 — `tool_timeout_sec` bez górnego limitu,
  domyślnie 300 s, `min(server, requested)`, `requested = None` dla wywołań modelu; TS SDK
  1.30.0 — brak timeoutu żądań przychodzących). Nie sprawdzono empirycznie 90-minutowego
  wywołania MCP ani zachowania `--max-turns` przy `--resume`: to wymaga płatnej sesji.
- Claude Code jako klient: per-server `timeout` (ms) nadpisuje `MCP_TOOL_TIMEOUT`; domyślny
  idle timeout stdio to 30 minut. Twardy domyślny limit (prawdopodobnie `1e8` ms) odczytano ze
  zminifikowanej binarki — traktować jako niepewny; dlatego konfiguracja ustawia `timeout`
  jawnie.
- Dowody zakończenia powstają, gdy proces runtime się zamknie. Zabity proces bridge’a nie
  zostawi pliku; nie ma rotacji ani retencji — pliki kasuje się ręcznie. Redakcja obejmuje
  znane kształty sekretów i uchwyty sesji, więc jest zabezpieczeniem, nie gwarancją.
- Podniesienie limitu tur 64 → 256 to świadoma zmiana budżetu do przeglądu: bez niej deadline
  75 minut nie dawałby realnie dłuższej rundy (domyślny limit 12 tur pozostaje bez zmian).

## Co pozostaje poza tym zadaniem

Izolacja managerów i tożsamość worktree (wave7 etapy 2–3), instalator, eksport diagnostyczny,
retencja dowodów, merge i wdrożenie tego brancha, wznowienie zachowanego featura.
