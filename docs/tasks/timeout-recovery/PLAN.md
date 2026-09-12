# Timeout recovery, długie rundy i dowody zakończenia — plan

Branch `timeout-recovery`, osobny worktree tego brancha (`<local-workspace>/bridge-timeout-recovery`),
baza `aeb92c2` (feature-workflow). Aktywny runtime (główny checkout i worktree wave7)
nie jest edytowany, budowany ani restartowany. Kryteria odbioru: [ACCEPTANCE.md](ACCEPTANCE.md).
Postęp: [PROGRESS.md](PROGRESS.md). Procedura wdrożenia: [DEPLOY-AND-RESUME.md](DEPLOY-AND-RESUME.md).

Zapisy o aktywnym runtime i weryfikacji klientów opisują moment przygotowania planu
źródłowego, nie bieżące środowisko wave7. Aktualny status integracji i ograniczenia dowodów:
[wave9 progress](../../plans/wave9-progress.md). Nie wykonywać historycznych kroków ponownie.

## Przyczyna błędu (stan na aeb92c2)

Runda W7-ID-01 (`<task-id>`) dostała `deadline_ms = 900000`. Po 15 minutach:

1. `Orchestrator.runAttempt` (timer deadline) abortuje kontroler; `ClaudeCodeRunner`
   zabija proces (SIGTERM, exit 143) i zwraca wynik „cancelled” bez stderr;
   `ClaudeAdapter` podnosi blocker (task `BLOCKED`) i zwraca PARTIAL.
2. Orchestrator widzi `timedOut`, rzuca `TIMEOUT`, kończy próbę z outcome `TIMEOUT`
   i przestawia task `BLOCKED → FAILED` (terminalny). Uchwyt sesji zostaje w próbie 0.
3. `TaskService.assertRecoverable` odrzuca `FAILED`, więc
   `bridge_resume_delegated_task` nie ma legalnej ścieżki mimo zachowanego uchwytu.
   Instrukcje (bridge-loop, feature-workflow) mówią „FAILED nie jest odzyskiwalny”.
4. Recovery `BLOCKED` bez jawnego deadline’u używa `spec.deadline_ms` albo domyślnych
   10 minut; nie było sposobu jawnego wydłużenia budżetu.
5. Stderr (≤ 64 000 znaków) istnieje tylko w pamięci runnera; ścieżki timeout/cancel
   go nie zwracają, a proces bridge’a go nie zapisuje.

Dodatkowe ograniczenie znalezione przy weryfikacji: `MAX_TASK_MAX_TURNS = 64`, a
persistowany `spec.max_turns` (32 w W7-ID-01) jest używany także przy recovery. Przy
tempie z diagnozy (40 wywołań narzędzi w ~13 min) 75-minutowa runda skończyłaby się na
limicie tur po ~25–30 minutach. Sam deadline 75 min nie oznaczałby więc wsparcia.

## Decyzje

- **D1 — jawne API.** `bridge_resume_delegated_task` dostaje `recover_timeout: true`
  (opt-in), `deadline_ms` i `max_turns`. `bridge_resume_task` (właściciel) dostaje
  tylko `deadline_ms`/`max_turns`; `recover_timeout` jest tam odrzucane — terminalny
  timeout może wznowić wyłącznie manager potwierdzony przez lineage. Brak nowego
  narzędzia; brak automatycznego wywołania czegokolwiek.
- **D2 — kwalifikacja (jedna transakcja rezerwacji, wszystkie warunki):**
  autoryzacja delegowana (bezpośredni parent należy do wywołującego, child utworzony
  przez niego, wywołujący ≠ właściciel); dla featura `feature.manager` = wywołujący,
  stan ≠ `waiting_user`/`accepted`, task = `latest_task_id`; task `FAILED`;
  bieżąca próba zakończona z outcome `TIMEOUT` i agentem = właściciel; ostatnie
  przejście do `FAILED` wykonane przez właściciela z przyczyną `TIMEOUT:` po zakończeniu
  tej próby; telemetria próby (jeśli jest) `termination_kind = timeout`; zachowany
  uchwyt; brak późniejszej próby, aktywnego recovery w procesie, żywej lub kolidującej
  lease; adapter z capability `resume`; poprawny lineage i zależności.
  Każdy inny `FAILED` (ADAPTER_FAILURE, ręczny FAILED, FAILED deliverable, profil)
  pozostaje terminalny.
- **D3 — przejście stanu.** `TaskService.beginRecovery` w trybie `timeout` pozwala
  wyłącznie na `FAILED → WORKING` z przyczyną `timeout_recovery`; `ALLOWED_TRANSITIONS`
  bez zmian (`bridge_set_state` nadal nie wyjdzie z `FAILED`). Historyczna próba nie
  jest ponownie zamykana ani modyfikowana; nowa próba `N+1` ma `resumed_from_attempt = N`
  i ten sam uchwyt. Ten sam task ID, feature (`task_ids` bez zmian) i sesja natywna.
- **D4 — deadline.** W trybie `timeout` `deadline_ms` jest wymagany (bez domyślnej
  wartości, bez ponownego użycia 15 min). Zakres 1 000–86 400 000 ms jak w
  `bridge_feature_run`. Opcjonalny `max_turns` (zakres protokołu) nadpisuje limit tur
  tylko dla tej próby; kontrakt taska w SQLite się nie zmienia. W trybie `BLOCKED`
  oba są opcjonalne, zachowanie domyślne bez zmian.
- **D5 — idempotencja.** Tryb `timeout` wymaga `idempotency_key`. Hash żądania obejmuje
  `recover_timeout`, `deadline_ms`, `max_turns`, `message` (tylko gdy podane, więc stare
  rekordy idempotencji nadal pasują). Ten sam klucz: dołączenie do trwającego wykonania
  albo replay zapisanego wyniku bez uruchamiania wykonawcy; inne argumenty →
  `IDEMPOTENCY_MISMATCH`; nowy klucz po starcie → odrzucony (task już nie jest `FAILED`,
  żywa lease lub aktywne recovery).
- **D6 — waiting_user bez zmian.** Recovery featura w `waiting_user` jest odrzucane;
  `bridge_feature_answer_user` tylko zapisuje odpowiedź (feature → `blocked`), nie
  uruchamia wykonawcy. Kontynuacja wymaga osobnego jawnego wywołania recovery.
- **D7 — dowody zakończenia.** Nowy opcjonalny callback
  `InvocationContext.recordTerminationEvidence`. Runner Claude’a wywołuje go dla każdego
  zakończenia innego niż `completed` (timeout, cancel, brak result frame, błąd runtime,
  max turns, profil) po zamknięciu procesu. Control plane zapisuje plik JSON
  `<katalog bazy>/evidence/<task_id>/attempt-<N>.json` (0600, katalog 0700, bez
  nadpisywania), maks. 16 KiB ogona stderr po redakcji (wzorce sekretów, uchwyty sesji),
  metadane procesu i strumienia (liczniki typów ramek, czasy), bez promptu, argv i treści
  ramek. Zdarzenie `attempt.evidence_recorded` ma tylko metadane; `bridge_get_task`
  zwraca listę metadanych i ścieżkę, nigdy treść stderr. Nic nie trafia na stdout MCP.
  Baza `:memory:` bez jawnego `evidenceDir` nie zapisuje plików.
- **D8 — długie rundy.** Deadline wykonawcy (bridge zabija proces) jest niezależny od
  timeoutu wywołania MCP (klient przestaje czekać; bridge pracuje dalej). Konfiguracja:
  runda `deadline_ms = 4 500 000` (75 min), Codex `tool_timeout_sec = 5400` (90 min),
  margines 15 min na kill grace (5 s), finalizację i odpowiedź. `MAX_TASK_MAX_TURNS`
  64 → 256 (nadal skończony). Claude jako klient: per-server `"timeout": 5400000` w
  `.mcp.json`, bo domyślny idle timeout stdio to 30 min.
- **D9 — brak automatyzmów.** Żadnych automatycznych retry, żadnego fallbacku do świeżej
  sesji, żadnych zmian w ręcznie edytowanym SQLite. Drugi timeout w recovery kończy się
  `BLOCKED` (istniejąca semantyka), dalej tylko jawna decyzja managera/użytkownika.

## Weryfikacja klientów (fakty ze źródeł, nie z parsera)

- **Codex CLI 0.154.0** (tag `rust-v0.154.0`, `codex-rs`): `tool_timeout_sec` →
  `Duration::try_from_secs_f64` (config/src/mcp_types.rs), bez górnego limitu; domyślnie
  `DEFAULT_TOOL_TIMEOUT = 300 s` (codex-mcp/src/rmcp_client.rs); efektywny timeout =
  `min(server, requested)`, a wywołania narzędzi modelu przekazują `requested = None`
  (core/src/mcp_tool_call.rs:456); `active_time_timeout` (rmcp-client) mierzy aktywny
  czas i wstrzymuje licznik podczas elicitation. W kodzie timeoutu nie znaleziono
  wysyłania `notifications/cancelled`. 5400 s jest więc realnie honorowane przez klienta.
  Nie uruchomiono płatnej sesji Codex z 90-minutowym wywołaniem — to pozostaje
  niesprawdzone empirycznie.
- **Serwer MCP (TS SDK 1.30.0):** brak timeoutu dla przychodzących żądań; ewentualne
  `notifications/cancelled` tylko abortuje `extra.signal`, którego handlery bridge’a nie
  używają, i tłumi odpowiedź. Runda działa dalej do własnego deadline’u.
- **Bridge:** `setTimeout` (limit 2^31−1 ms), lease TTL = deadline + 30 s, kill grace 5 s,
  schemat `deadline_ms ≤ 86 400 000`. Przy zamknięciu transportu przez klienta proces
  bridge’a kończy się (lifecycle.ts) — klient nie może zamykać serwera w trakcie rundy.
- **Claude Code 2.1.269** (binarka): per-server `timeout` (ms) nadpisuje `MCP_TOOL_TIMEOUT`;
  idle timeout dla stdio domyślnie 1 800 000 ms, efektywnie `max(idle, timeout)`;
  twardy limit domyślny prawdopodobnie `1e8` ms (odczyt ze zminifikowanego kodu, niepewny).
  Bridge nie wysyła progress notifications. Dotyczy tylko Claude’a jako klienta bridge’a.
- **Claude Code jako wykonawca:** `--max-turns` jest przekazywany przy każdej próbie
  (także `--resume`); per-invocation zachowanie limitu tur przy resume nie zostało
  potwierdzone płatnym uruchomieniem.

## Zmiany (pliki)

- `shared/protocol`: typy żądań/wyniku recovery (`recover_timeout`, `deadline_ms`,
  `max_turns`, `recovery_mode`), `TerminationEvidence`, `EventType.ATTEMPT_EVIDENCE_RECORDED`,
  `MAX_TASK_MAX_TURNS = 256`.
- `shared/control-plane`: `orchestrator.ts` (walidacja, kwalifikacja D2, rezerwacja,
  hash, callback dowodów), `task-service.ts` (`beginRecovery` tryb timeout),
  `evidence-store.ts` (nowy), `control-plane.ts` (`evidenceDir`), eksport wzorców sekretów.
- `shared/mcp-server-core/src/tools.ts`: parametry narzędzi, `termination_evidence` w
  `bridge_get_task`, opisy; `server.ts` instrukcje.
- `claude/claude-side`: runner zbiera metadane strumienia/procesu i wywołuje callback;
  fixture fake CLI (`FAKE_CLAUDE_STDERR`).
- Konfiguracja: `.codex/config.toml` (5400), `.mcp.json` i przykład Claude’a (`timeout`).
- Dokumentacja i instrukcje ról: `docs/{recovery,feature-workflow,PROTOCOL,troubleshooting,fork-setup}.md`,
  README, `.agents/skills/feature-execute/{SKILL.md,references/bridge-loop.md}`,
  `.codex|.claude/skills/using-bridge/**` (kopie identyczne).

## Testy (atrapa wykonawcy, krótkie limity, bez płatnych modeli)

1. Control plane, SQLite w pliku: feature round z timeoutem (deadline 50 ms) → FAILED,
   uchwyt, telemetria → zamknięcie i ponowne otwarcie (restart) → jawne recovery z
   dłuższym deadline’em: ten sam task/sesja, próba 1, historia próby 0 nietknięta,
   lease TTL i `deadline_at` z nowego deadline’u, feature `awaiting_review`.
2. Idempotencja: równoległe to samo żądanie, replay po zakończeniu, nowy klucz, zmienione
   argumenty.
3. Odmowy bez wywołania wykonawcy i bez nowej próby: brak uchwytu, inna przyczyna FAILED
   (ADAPTER_FAILURE; ręczny FAILED po timeoucie), zły manager (inny caller, właściciel,
   rozbieżny `feature.manager`), aktywna próba (w procesie, drugi proces, niezamknięta
   próba), brak/niepoprawny deadline lub klucz, tryb timeout dla BLOCKED lub przez owner.
4. Strict resume: zmieniony lub brakujący uchwyt → błąd, `BLOCKED`, jedna inwokacja,
   brak nowego taska/sesji.
5. waiting_user: recovery odrzucone, odpowiedź nie uruchamia wykonawcy, potem jawne
   recovery działa.
6. Rekord w kształcie sprzed poprawki (sekwencja zdarzeń jak w wave7, bez nowych pól).
7. Runner + fake CLI: stderr dostępne po timeout i po cancel, redakcja, limit, brak
   promptu/uchwytu, plik 0600, brak nadpisania, metadane w `bridge_get_task`.
8. E2E przez prawdziwy launcher stdio z fake `claude` na PATH: timeout → restart procesu
   bridge’a → `bridge_resume_delegated_task` z `recover_timeout` → DONE tej samej sesji;
   stdout czysty JSON-RPC, plik dowodu obecny.

## Poza zakresem

Izolacja managerów, instalator, eksport diagnostyczny wave7, retencja/rotacja dowodów,
push, wdrożenie, recovery zachowanego taska wave7, płatne uruchomienia modeli.
