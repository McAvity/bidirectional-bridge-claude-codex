# Procedura: wdrożenie sprawdzonego runtime i wznowienie rundy wave7

Procedura referencyjna, nie polecenie ponownego recovery aktywnego wave7.
Wszystkie `<task-id>`, identyfikatory pytań i oczekiwane numery prób należy ustalić
z konkretnego autoryzowanego przypadku. Przykład wiadomości poniżej jest syntetyczny,
nie jest zapisem odpowiedzi użytkownika. Aktualny stan: [wave9 progress](../../plans/wave9-progress.md).

Historycznie **nie wykonano jej** w ramach zadania źródłowego: nic nie wdrożono, nie
restartowano, nie zmieniono baz ani nie uruchomiono zachowanego taska. Wykonanie wymaga
osobnej, jawnej zgody użytkownika.

Cel: uruchomić przejrzany runtime z branchu `timeout-recovery` obok działających sesji, a
następnie jednorazowo wznowić rundę W7-ID-01 (`<task-id>`, feature
`F-W7-manager-isolation`) w tej samej natywnej sesji Claude’a, z jawnie dłuższym budżetem.

## 0. Fakty do potwierdzenia przed startem

| Co | Jak sprawdzić | Oczekiwane |
| --- | --- | --- |
| Który proces obsługuje którą bazę | `pgrep -af native-bridge-mcp`, `readlink /proc/<pid>/cwd` | znane cwd; żadna sesja nie korzysta z katalogu, który będziemy budować |
| Czy ktoś trzyma otwartą bazę featura | `pgrep -af native-bridge-mcp`; `fuser -v <wave7-worktree>/.bridge/bridge.db` lub `lsof <ten sam plik>` | żaden proces nie ma pliku otwartego — to jedyny dowód zamknięcia |
| Pliki stanu bazy featura | `ls -l <wave7-worktree>/.bridge/` | `bridge.db` istnieje. Obecność lub brak `-wal`/`-shm` niczego nie dowodzi: czyste zamknięcie je usuwa, a po awarii mogą zostać osierocone. Informacja pomocnicza, nie kryterium |
| Branch/commit do wdrożenia | `git -C <repo> log --oneline -1 timeout-recovery` | commit po review |
| Wersje | `node -v`, `python3 -V`, `codex --version`, `claude --version` | Node 24.x; reszta jak w raporcie |

Nie przebudowuj i nie podmieniaj runtime, który w danej chwili nadzoruje żywego workera.

## 1. Review i walidacja przed wdrożeniem

1. Przegląd diffu `feature-workflow..timeout-recovery` (kod, testy, instrukcje, konfiguracja).
2. W worktree zadania: `npm ci --ignore-scripts`, `npm run build`, `npm test`,
   `python3 -m unittest discover -s tests`, `python3 -m unittest discover -s tools/pilot/tests`.
3. Decyzja użytkownika: zgoda na (a) wdrożenie runtime, (b) dłuższy budżet rundy
   (75 min / ~200 tur), (c) jednorazowe wznowienie `<task-id>`.

## 2. Przypięty build obok aktywnych sesji

```sh
# <bridge-checkout> = katalog forka, <runtime-dir> = nowy katalog na przypięty build
SHA=<reviewed-integration-sha>
git -C <bridge-checkout> worktree add <runtime-dir>-$SHA "$SHA"
cd <runtime-dir>-$SHA && npm ci --ignore-scripts && npm run build && npm test
```

To osobny katalog: żaden istniejący `dist/` używany przez aktywną sesję nie jest nadpisywany.
Merge do `feature-workflow` może nastąpić później; runtime wskazujemy po commicie.

## 3. Skierowanie managera wave7 na przypięty build

Manager Astra ma pracować z workspace = worktree wave7 (tam powstała sesja Claude’a i tam
leży baza featura), ale z launcherem z przypiętego buildu:

```
command = "node"
args = [
  "<runtime-dir>-<SHA>/scripts/native-bridge-mcp.mjs",
  "--caller", "codex", "--delegation", "allow",
  "--workspace", "<wave7-worktree>",
  "--db", "<wave7-worktree>/.bridge/bridge.db"
]
cwd = "<wave7-worktree>"
startup_timeout_sec = 30
tool_timeout_sec = 5400
```

Dwie drogi: zmiana `<wave7-worktree>/.codex/config.toml` (zmiana w branchu wave7, do
odnotowania) albo nadpisanie przy starcie przez `codex -c ...`. Składnię nadpisań potwierdzić
lokalnie (`codex --help`, `codex mcp`) przed użyciem — w tym zadaniu zweryfikowano tylko
obsługę pól konfiguracji w źródłach Codex 0.154.0, nie ścieżkę `-c`.

Workspace musi być dokładnie tą samą ścieżką co w pierwotnej próbie: Claude odnajduje sesję
`--resume` po katalogu projektu. Przy innej ścieżce próba recovery wystartuje, ale runtime nie
potwierdzi zachowanej sesji: próba kończy się `ADAPTER_FAILURE`, task przechodzi w `BLOCKED`
(nowa próba zostaje w historii), a nowa sesja nie powstaje nigdy.

## 4. Dostarczenie zaktualizowanych instrukcji do worktree wave7

Przypięty build **nie zmienia instrukcji, którymi kieruje się Astra**: skille i dokumentację
czyta ona z plików worktree wave7 (branch `wave7`), a nie z katalogu runtime. Bez tego kroku
manager nadal działałby wg reguły „terminalny `FAILED` jest nieodzyskiwalny” i nie użyłby
`recover_timeout` ani nowych budżetów. Krok wykonać przed startem managera.

Zakres — dokładnie te ścieżki, nic więcej:

```sh
git -C <wave7-worktree> checkout <reviewed-integration-sha> -- \
  .agents/skills/feature-execute/SKILL.md \
  .agents/skills/feature-execute/references/bridge-loop.md \
  .codex/skills/using-bridge/SKILL.md \
  .codex/skills/using-bridge/references/recovery-and-failures.md \
  .codex/skills/using-bridge/references/tool-map.md \
  .claude/skills/using-bridge/SKILL.md \
  .claude/skills/using-bridge/references/recovery-and-failures.md \
  .claude/skills/using-bridge/references/tool-map.md \
  docs/recovery.md docs/feature-workflow.md docs/PROTOCOL.md \
  docs/troubleshooting.md docs/fork-setup.md README.md \
  docs/tasks/timeout-recovery/
```

Nie dostarczaj `docs/HANDOFF.md` (wave7 ma tam własne zapisy) ani niczego z
`docs/features/**`, `docs/plans/**`, `docs/tasks/wave7-identity-*` — to własność featura.
`.codex/config.toml` należy do kroku 3: dostarcz go tylko w wariancie z plikiem konfiguracji,
nie przy `codex -c`.

Zachowanie istniejących zmian: sprawdź osobno working tree, index i zmiany commitowane
w docelowym worktree. Nie zakładaj, że historycznie rozłączne zmiany nadal są rozłączne.
`git status --short` oraz `git diff` i `git diff --cached` dla listy ścieżek muszą być puste.
Dodatkowo sprawdź zmiany commitowane przed wykonaniem:
`git -C <wave7-worktree> diff --stat feature-workflow wave7 -- <lista ścieżek>` musi być puste;
jeśli nie jest, zatrzymaj się i uzgodnij scalenie zamiast nadpisywać.

Weryfikacja przed commitem w worktree wave7:

1. `git -C <wave7-worktree> status --short` — zmienione wyłącznie ścieżki z listy; żaden plik
   featura nie jest ruszony.
2. `git -C <wave7-worktree> diff --cached --stat` zgodne z
   `git diff --stat feature-workflow timeout-recovery -- <lista ścieżek>`.
3. `diff -r <wave7-worktree>/.codex/skills/using-bridge <wave7-worktree>/.claude/skills/using-bridge`
   — kopie muszą być identyczne (wymaganie testu launchera).
4. `node <wave7-worktree>/docs/tools/check-doc-links.mjs` — dokumentacja spójna (skrypt nie ma
   zależności, nie wymaga `node_modules`).
5. Osobny lokalny commit w branchu `wave7` (np. `docs(wave7): adopt timeout recovery
   instructions`), bez push i bez mieszania z wynikami rundy.
6. Astra po dostarczeniu czyta ponownie `bridge-loop.md` i `recovery-and-failures.md`; jeśli
   klient cache’uje listę skilli, wystarczy restart sesji przy kroku 6 (i tak potrzebny dla
   nowego launchera oraz `tool_timeout_sec`).

## 5. Kopia zapasowa bazy featura (przed startem managera)

Kopię wykonaj zanim uruchomisz managera — wtedy punkt odniesienia jest jednoznaczny. Użyj
kopii zapasowej SQLite, a nie kopiowania plików: kopiowanie samego `bridge.db` pomija zapisy
z dziennika WAL i daje niespójny obraz.

```sh
sqlite3 "<wave7-worktree>/.bridge/bridge.db" ".backup '<backup-dir>/bridge-<data>.db'"
```

Bez `sqlite3` w systemie: funkcja `backup` z modułu `node:sqlite` (dostępna w Node 24.15).
Nie kopiuj osobno `bridge.db`, `-wal` i `-shm`.

Sprawdzenie kopii — wyłącznie na kopii, nigdy na bazie roboczej:

```sh
sqlite3 -readonly "<backup-dir>/bridge-<data>.db" "PRAGMA integrity_check;"
sqlite3 -readonly "<backup-dir>/bridge-<data>.db" \
  "SELECT state, attempt FROM tasks WHERE task_id='<task-id>';"
sqlite3 -readonly "<backup-dir>/bridge-<data>.db" \
  "SELECT attempt, outcome, ended_at IS NOT NULL FROM task_attempts WHERE task_id='<task-id>';"
```

Oczekiwane: `ok`, `FAILED|0`, `0|TIMEOUT|1`. Inny wynik `integrity_check` albo brak tych
wierszy = zatrzymaj procedurę i zgłoś to użytkownikowi. Kopia służy odtworzeniu stanu, nie
edycji; bazy roboczej nie zmieniamy w żadnym kroku.

## 6. Start managera i preflight (bez mutacji)

1. Potwierdzić procesami, że nikt nie pracuje na tej bazie ani nie jest workerem tej próby:
   `pgrep -af native-bridge-mcp`, `pgrep -af claude`, oraz `fuser -v <wave7-worktree>/.bridge/bridge.db`
   lub `lsof <wave7-worktree>/.bridge/bridge.db` (jeśli narzędzie jest dostępne). Dowodem jest
   wyłącznie sprawdzenie procesów; listing plików `.bridge/` nim nie jest.
2. Wznowić **dokładnie** przypisaną sesję Astry (`codex resume <session-id>` z zapisanego
   identyfikatora), nigdy „najnowszą z cwd”, nigdy guardiana.
3. `bridge_server_info` → `caller: codex`, `delegation: allow`.
4. `bridge_feature_get({feature_id: "F-W7-manager-isolation"})` → `waiting_user` z q-01.
5. `bridge_get_task({task_id: "<task-id>"})` → `state: FAILED`; próba 0 z
   `outcome: "TIMEOUT"`, zachowanym uchwytem (nie drukować wartości), brak późniejszej próby,
   brak żywej lease; `termination_evidence` dla starej rundy będzie puste (poprzedni runtime
   dowodów nie zapisywał) — to oczekiwane.
6. Potwierdzić, że prywatny transkrypt sesji dla tego worktree nadal istnieje (dopasowanie po
   dokładnym uchwycie próby, bez publikowania wartości).
7. Rozliczyć q-01 rzeczywistą odpowiedzią użytkownika:
   `bridge_feature_answer_user({feature_id, question_id: "q-01", answer: "<słowa użytkownika>"})`.
   To tylko zapis — nie uruchamia wykonawcy; feature wraca do `blocked`.

## 7. Jednorazowe wznowienie

```json
bridge_resume_delegated_task({
  "task_id": "<task-id>",
  "recover_timeout": true,
  "deadline_ms": 4500000,
  "max_turns": 200,
  "idempotency_key": "F-W7-manager-isolation:<task-id>:timeout-recovery-1",
  "message": "Poprzednia próba została zatrzymana przez bridge po 15 minutach, zanim powstał kontrakt. Kontynuuj ten sam task W7-ID-01 w tej samej sesji: zachowaj dotychczasowe ustalenia, nie zaczynaj od nowa. Budżet tej próby: 75 minut i 200 tur. Zakres, cel i kryteria bez zmian."
})
```

- Oczekiwane: ten sam `task_id`, `recovered_attempt: 1`, `resumed_from_attempt: 0`,
  `same_execution_handle: true`, `recovery_mode: "timeout"`, `deadline_ms: 4500000`.
- Klient może przestać czekać przed końcem rundy — runda trwa dalej. Wtedy
  `bridge_feature_get`: `running` → czekać (`sleep 60`–`120` i czytać ponownie);
  `awaiting_review`/`blocked` → `bridge_get_task` po wynik. Nie powtarzać z nowym kluczem.
- Powtórzenie tego samego żądania (ten sam klucz i argumenty) zwraca pierwotny wynik i nie
  uruchamia drugiego wykonawcy.

## 8. Wyniki i decyzje

Odmowa żądania i nieudany strict resume to dwa różne stany — pierwszy nie tworzy próby i nie
zmienia taska, drugi zostaje w historii jako zakończona próba.

| Wynik | Co się stało w stanie trwałym | Działanie |
| --- | --- | --- |
| `DONE`, feature `awaiting_review` | Próba `N+1` zakończona `COMPLETE`. | Normalne review rundy wg bridge-loop: paczka, `git diff base..head`, ledger, `reviews/NN`. |
| `BLOCKED` z blokerem merytorycznym | Próba `N+1` zakończona `PARTIAL`; task czeka na wyjaśnienie. | Zwykła ścieżka `bridge_resume_delegated_task` z `message` i jawnym `deadline_ms`, albo pytanie do użytkownika. |
| `BLOCKED` po kolejnym timeoucie | Próba `N+1` zakończona `TIMEOUT`; task `BLOCKED`, nie `FAILED`. | Przeczytać `termination_evidence` nowej próby (`jq . <wave7-worktree>/.bridge/evidence/<task-id>/attempt-1.json`), przedstawić użytkownikowi przyczynę i propozycję (podział rundy, inny budżet). Bez automatycznego kolejnego wznowienia. |
| **Żądanie odrzucone przed rezerwacją** — błąd MCP: brak zachowanego uchwytu, przyczyna `FAILED` inna niż deadline bridge’a, brak lub zły `deadline_ms`/klucz, feature `waiting_user`, aktywna próba lub lease, niewłaściwy manager | Nic się nie zmieniło: brak nowej próby, task nadal `FAILED`, feature `blocked`, historia i telemetria bez zmian. | Odczytać `code` i `details` błędu. Poprawić wyłącznie przyczynę formalną (np. brakujący `deadline_ms`); warunku merytorycznego nie obchodzić — zgłosić użytkownikowi. |
| **Strict resume rozpoczętej próby nie potwierdził sesji** — inny uchwyt albo brak potwierdzenia (np. zły workspace, usunięty transkrypt) | Próba `N+1` istnieje i jest zamknięta błędem `ADAPTER_FAILURE`; task kończy jako `BLOCKED`; uchwyt w próbie pozostaje pierwotny; lease zwolniona; `same_execution_handle: false`. | Zatrzymać się i zgłosić dokładny błąd. Sprawdzić ścieżkę workspace i obecność transkryptu przed jakąkolwiek kolejną próbą. Nie tworzyć zastępczego taska ani nowej sesji. |

Po zamknięciu sprawy zaktualizować `docs/features/F-W7-manager-isolation/PROGRESS.md`,
`feature.json` i checkpoint integracji; wynik rundy rozliczyć review, nie samym `COMPLETE`.

## 9. Wycofanie

- Runtime: przełączyć konfigurację MCP z powrotem na poprzedni launcher i zrestartować
  managera. Usunąć przypięty worktree (`git worktree remove`) dopiero, gdy nic go nie używa.
- Baza: przywracać z kopii tylko wtedy, gdy po kopii nie zapisano nic wartościowego —
  przywrócenie kasuje nową próbę i jej historię. Nigdy nie edytować SQLite ręcznie.
- Pliki dowodów zostają; usuwać je świadomie po zamknięciu featura.

## 10. Zabronione w tej procedurze

Budowanie lub podmiana runtime obsługującego żywą sesję; ręczna edycja SQLite; odblokowywanie
innych `FAILED`; automatyczne retry; zastępcza sesja Claude’a lub zastępczy task; uruchamianie
płatnych pilotów wave6/wave7; publikowanie uchwytów sesji, transkryptów i surowego stderr.
