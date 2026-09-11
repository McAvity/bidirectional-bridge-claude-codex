# Procedura: wdrożenie sprawdzonego runtime i wznowienie rundy wave7

Gotowa do review. **Nie wykonano jej** w ramach tego zadania: nic nie wdrożono, nie
restartowano, nie zmieniono baz ani nie uruchomiono zachowanego taska. Wykonanie wymaga
osobnej, jawnej zgody użytkownika.

Cel: uruchomić przejrzany runtime z branchu `timeout-recovery` obok działających sesji, a
następnie jednorazowo wznowić rundę W7-ID-01 (`<task-id>`, feature
`F-W7-manager-isolation`) w tej samej natywnej sesji Claude’a, z jawnie dłuższym budżetem.

## 0. Fakty do potwierdzenia przed startem

| Co | Jak sprawdzić | Oczekiwane |
| --- | --- | --- |
| Który proces obsługuje którą bazę | `pgrep -af native-bridge-mcp`, `readlink /proc/<pid>/cwd` | znane cwd; żadna sesja nie korzysta z katalogu, który będziemy budować |
| Baza featura wave7 | `ls -l <wave7-worktree>/.bridge/` | `bridge.db` bez `-wal`/`-shm` = nikt nie trzyma bazy otwartej |
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
SHA=$(git -C <bridge-checkout> rev-parse timeout-recovery)
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
`--resume` po katalogu projektu. Inna ścieżka = odmowa strict resume (task zostanie BLOCKED),
nigdy nowa sesja.

## 4. Start managera i preflight (bez mutacji)

1. Wznowić **dokładnie** przypisaną sesję Astry (`codex resume <session-id>` z zapisanego
   identyfikatora), nigdy „najnowszą z cwd”, nigdy guardiana.
2. `bridge_server_info` → `caller: codex`, `delegation: allow`.
3. Kopia zapasowa bazy przy zatrzymanym bridge’u (nie edycja!):
   `cp <wave7>/.bridge/bridge.db <backup>/bridge.db.<data>` — przy istniejących `-wal`/`-shm`
   skopiować wszystkie trzy pliki albo użyć `sqlite3 <db> ".backup <backup>"`.
4. `bridge_feature_get({feature_id: "F-W7-manager-isolation"})` → `waiting_user` z q-01.
5. `bridge_get_task({task_id: "<task-id>"})` → `state: FAILED`; próba 0 z
   `outcome: "TIMEOUT"`, zachowanym uchwytem (nie drukować wartości), brak późniejszej próby,
   brak żywej lease; `termination_evidence` dla starej rundy będzie puste (poprzedni runtime
   dowodów nie zapisywał) — to oczekiwane.
6. Potwierdzić, że nie żyje żaden proces workera tej próby (`pgrep -af claude`) ani bridge
   trzymający tę bazę.
7. Potwierdzić, że prywatny transkrypt sesji dla tego worktree nadal istnieje (dopasowanie po
   dokładnym uchwycie próby, bez publikowania wartości).
8. Rozliczyć q-01 rzeczywistą odpowiedzią użytkownika:
   `bridge_feature_answer_user({feature_id, question_id: "q-01", answer: "<słowa użytkownika>"})`.
   To tylko zapis — nie uruchamia wykonawcy; feature wraca do `blocked`.

## 5. Jednorazowe wznowienie

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

## 6. Wyniki i decyzje

| Wynik | Działanie |
| --- | --- |
| `DONE`, feature `awaiting_review` | Normalne review rundy wg bridge-loop: paczka, `git diff base..head`, ledger, `reviews/NN`. |
| `BLOCKED` z blokerem merytorycznym | Zwykła ścieżka `bridge_resume_delegated_task` z `message` i jawnym `deadline_ms`, albo pytanie do użytkownika. |
| `BLOCKED` po kolejnym timeoucie | Przeczytać `termination_evidence` nowej próby (`jq . <wave7>/.bridge/evidence/<task-id>/attempt-1.json`), przedstawić użytkownikowi przyczynę i propozycję (podział rundy, inny budżet). Bez automatycznego kolejnego wznowienia. |
| Odmowa strict resume (inny/brak uchwytu) | Zatrzymać się, zgłosić dokładny błąd. Nie tworzyć zastępczego taska ani nowej sesji. |

Po zamknięciu sprawy zaktualizować `docs/features/F-W7-manager-isolation/PROGRESS.md`,
`feature.json` i checkpoint integracji; wynik rundy rozliczyć review, nie samym `COMPLETE`.

## 7. Wycofanie

- Runtime: przełączyć konfigurację MCP z powrotem na poprzedni launcher i zrestartować
  managera. Usunąć przypięty worktree (`git worktree remove`) dopiero, gdy nic go nie używa.
- Baza: przywracać z kopii tylko wtedy, gdy po kopii nie zapisano nic wartościowego —
  przywrócenie kasuje nową próbę i jej historię. Nigdy nie edytować SQLite ręcznie.
- Pliki dowodów zostają; usuwać je świadomie po zamknięciu featura.

## 8. Zabronione w tej procedurze

Budowanie lub podmiana runtime obsługującego żywą sesję; ręczna edycja SQLite; odblokowywanie
innych `FAILED`; automatyczne retry; zastępcza sesja Claude’a lub zastępczy task; uruchamianie
płatnych pilotów wave6/wave7; publikowanie uchwytów sesji, transkryptów i surowego stderr.
