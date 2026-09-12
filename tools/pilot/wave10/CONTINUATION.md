# Wave10 — kontynuacja zachowanego R1 (operator only)

Scope `wave10-retained-r1-continuation-v1`, do zatwierdzenia. To osobny segment po
przerwie i zakończeniu obu TUI, nie nieprzerwany pilot v2. Bez ponowienia R1,
nowych managerów A/B, baz, worktree, feature ani sesji Claude’a. Operator działa
autonomicznie; użytkownik nie obsługuje terminali. Nie przekazywać tego dokumentu agentom.

## Rozstrzygnięcie licznika

W10-10: błędne porównanie było decyzją koordynatora, nie instrukcją `if` w starym
relay. Wycofujemy tę regułę; nie usuwamy żadnego limitu runnera ani nie poprawiamy
historycznej telemetrii na inną liczbę.

W dokładnym binarnym CLI 2.1.269 z R1 (SHA-256
`25e44883f54419569a3d739f38cbbdaebe83b09895da0f343e1b003710a4775b`):

- Zwykła, niedeferowana ścieżka wyniku success inicjuje licznik wyniku wartością 1
  i zwiększa go przy każdym komunikacie `user` strumienia silnika. W obu R1 było
  17 odrębnych `tool_result`: **num_turns = 1 + 17 = 18**.
- Strumieniowane bloki odpowiedzi mają wspólne message.id. W obu transkryptach było
  **12 różnych odpowiedzi modelu**, z czego **11 zawierało tool_use**, a jedna była
  odpowiedzią końcową. 11 to rekonstrukcja grup odpowiedzi z narzędziami, nie nowa
  definicja pola num_turns ani zamiennik parametru max_turns.
- Silnik ma osobny licznik przejść pętli: zwiększa go dla kolejnego obiegu i porównuje
  z limitem opcji. Gałąź przekroczenia emituje max_turns_reached; zewnętrzny wynik
  staje się error_max_turns. **W tej gałęzi num_turns jest wypełniany licznikiem
  przekroczenia**, a nie zwykłym licznikiem komunikatów success. Nie wolno uogólniać
  wzoru 1 + tool_result na wszystkie odmiany wyniku, resume i wersje CLI.
- Bridge `ClaudeCodeRunner.buildArgs` bierze zwalidowane spec.max_turns i przekazuje
  `--max-turns 12`; chroni flagę przed nadpisaniem extraArgs. `buildRunnerTelemetry`
  zachowuje frame.num_turns bez przeliczenia. Limit egzekwuje wykonawca, a rzeczywisty
  wynik max_turns trafia do FAILED. Parametry, terminations i liczniki przechowujemy osobno.

W R1 wystąpił completed/exit 0, nie max_turns. Rekonstrukcja i implementacja wyjaśniają
18 bez dowodu przekroczenia limitu 12. To nie jest test empiryczny przekroczenia granicy
CLI: nie uruchamiamy nowego modelu tylko w celu sprawdzania licznika.
[Dokumentacja pętli Claude](https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-messages)
wyjaśnia różnicę bloków/odpowiedzi/obiegów. Zgłoszenie #1795 jest informacją pomocniczą;
wniosek opiera się także na lokalnym kodzie wersji 2.1.269 i obu transkryptach.

Nowy operator nie porównuje num_turns do max_turns i nie zastępuje limitu liczeniem
message.id. Instrukcja wyjaśniająca jest w BOOT, RESTART i ROUND2 promptach.
Prawdziwy FAILED/TIMEOUT, max_turns, odmowa uprawnień/konta, zmiana bindingu lub sesji,
dodatkowa próba i koniec okna nadal oznaczają STOP, bez retry/recovery.

## Zachowany stan i przygotowanie bez modeli

Dotychczasowy runtime pozostaje przypięty do `9e8f060` w zachowanym katalogu pilota.
Nowy pin narzędzi operatora i katalog przygotowania są zapisane w końcu wave10-report.md.
Nowo zbudowane pomocnicze worktree służą wyłącznie handshake; nie są parami modelowego
pilota. Kontynuacja wykorzysta oryginalne `a`, `b`, bazy, namespace i paczki R1 oraz
oryginalny build bridge’a. Żadnych kopii baz do innych cwd ani podmiany runtime.

`continuation.py prepare --run "$ORIGINAL_RUN" --out "$CONT"` jest tylko odczytem
starego pilota. Sprawdza integralność SQLite, zakończone R1, waiting_user/q1, brak
aktywnego bindingu, zgodność UUID pliku sesji z bazą, dokładnie jeden rollout TUI
(source=cli/originator=codex-tui), dokładny transkrypt Claude’a, czysty HEAD i verify R1.
Zapisuje nowy manifest z hashami logicznego stanu, plików sesji, pakietów, promptów,
kodu operatora i CLI. Ponowny audit musi być identyczny. Brak lub drift to odmowa.
To potwierdza dostępność danych, **nie zalicza natywnego resume**. Nie wykonujemy teraz
manager_resume_instance ani bridge_feature_run, nawet z atrapą tożsamości.

`preflight --out "$CONT"` powtarza kontrolę tylko przed pierwszym startem segmentu.
`commands --out "$CONT"` generuje do prywatnego pliku dokładne komendy CLI z `resume UUID`
z bindingu: A-initial, B-initial, A-restart; foreign jest jedyną nową sesją managera.
Nie korzysta z --last, pickera, CODEX_THREAD_ID rodzica ani app-server.
Stary started-at i stary approval pozostają niezmienione. Manifest nowego scope i nowy
approval są oddzielne. Potwierdzenie subskrypcji pozostaje ważne; nie sprawdzamy paneli.

## Budżet do zatwierdzenia

| Wywołania / odcinek | Limit |
| --- | --- |
| Claude A/r2 | Jedna runda, max_turns=12, deadline 480000 ms |
| Claude B/r2 | Jedna runda, max_turns=12, deadline 1200000 ms |
| Astra A, ta sama sesja | 3 nowe tury: BOOT-A, RESTART-A, ROUND2-A z review |
| Astra B, ta sama sesja | 2 nowe tury: BOOT-B, ROUND2-B z review |
| Obcy manager | 1 nowa tura, dwa wywołania MCP: status i create_task; bez workerów |
| Start/koniec segmentu | 45 min od startu operatora; B/r2 najpóźniej w 20. minucie |
| B/r2 → gate-ready | 120 s od rzeczywistego startu próby |
| Gate-ready → restart A → A/r2 started → release | 480 s; gate 540 s, Bash 600 s |
| B/r2 / MCP | 1200 s / 1320 s; co najmniej 5 min na finalne dowody przy najpóźniejszym starcie |
| Retry, dodatkowe recovery, dodatkowe API | Zero; istniejące konta/subskrypcje |

Nie ma tur zapasowych, ukrytych rund ani automatycznych ponowień. Łącznie z R1:
4 rundy Claude’a, 4 tury A, 3 tury B, 1 foreign. To rozliczenie dwóch segmentów,
nie dowód jednej ciągłej godziny. BOOT i planowany restart managera nie są recovery
FAILED/TIMEOUT taska; nie wolno uruchamiać bridge_resume_delegated_task.

## Dokładna sekwencja operatora po zgodzie

1. Powtórz preflight; zapisz zgodę dla hash manifestu/scope/budżetu w nowym approval.json.
   Uruchom `continuation.py serve --out "$CONT"` z nowego pinu narzędzi. W nowym
   `$CONT/operator/inbox` podawaj atomowo numerowane pliki JSON. Relay zapisuje nowe
   logi/notify i pilnuje czasu; koordynator wybiera kroki według obserwowalnego stanu.
2. `start` klientów `a-initial` i `b-initial`: obie komendy są dokładnym resume.
   Po gotowości TUI `prompt` odpowiednio BOOT-A.txt i BOOT-B.txt. Poczekaj na oba
   końce tur/notify oraz zgodne manager_status, epoch, feature, stare R1 i q1.
   W razie potrzeby Astry same wywołują manager_resume_instance z odczytanym epoch/
   generation; bez takeover. Żadnej odpowiedzi q1 i żadnej rundy na tym etapie.
3. Gdy obie pary są waiting_user i nie ma aktywnych workerów, zapisz snapshot obu baz,
   markerów, ownerów i paczek (np. oryginalny pilot.py snapshot, nowy label cont-before-foreign).
   `start foreign`, po gotowości `prompt FOREIGN.txt`. W rzeczywistym zapisie MCP ma
   wystąpić MANAGER_FOREIGN_THREAD. Po końcu tury `close foreign`; snapshot
   cont-after-foreign. Porównaj **cały stan logiczny obu baz oraz markery/owner/paczki**.
   Musi być identyczny. Sam tekst końcowy modelu nie zastępuje wyniku narzędzia.
4. Po zaliczeniu porównania, przed 20. minutą, `prompt b-initial ROUND2-B.txt`.
   Sprawdź odpowiedź q1, idempotency_key=r2, limit runnera, zachowany session handle,
   aktywną próbę i gate-ready w 120 s. Zapisz czas oraz snapshot.
5. Dopiero teraz `close a-initial` przez /quit. Poczekaj na faktyczny EOF/exited, gdy B
   nadal ma aktywną próbę. `start a-restart` używa dokładnie tego samego UUID A.
   Po gotowości `prompt RESTART-A.txt`. Poczekaj na koniec tury: ta sama tożsamość,
   waiting_user/q1 bez odpowiedzi, właściwy binding nowej instancji. To jest właściwy
   test P4; wcześniejsze zamknięcie obu Astr nie zastępuje tego etapu.
6. `prompt a-restart ROUND2-A.txt`. Po rzeczywistym starcie A/r2 i markerze
   round2-started, gdy B nadal aktywne i okno 480 s nie minęło, wykonaj `release`.
   Nie czekaj na wynik A. Zapisz snapshot overlap i czasy; jeśli A już skończyła,
   jej trwały przedział musi przecinać aktywną próbę B. Brak dowodu → UNVERIFIED/STOP.
7. Czekaj na COMPLETE obu rund i autentyczne review Astr, zakończenia tur/notify.
   Sprawdź niezmienione sesje Claude’a, dokładnie po jednej nowej próbie/rundzie,
   brak nadpisania R1, verify **czterech** ZIP z bazami/headami właściwych rund oraz
   unittest obu końcowych worktree. Zachowaj stan i ocenę kryteriów przed zamknięciem.
   `close b-initial`, `close a-restart`, następnie `stop` operatora z wynikiem.

Przykładowy format akcji: `{"action":"start","client":"a-initial"}`,
`{"action":"prompt","client":"a-initial","file":"BOOT-A.txt"}`.
Nie przekazuj agentom manifestu operatora, approval ani cudzych katalogów/sesji.
Po błędzie nie restartuj relay: folder operator jest jednorazowy, bez resetu zegara.

## Ocena bez zmiany kryteriów

| Kryterium oryginalne | Możliwy dowód po kontynuacji |
| --- | --- |
| P1 | Oryginalny pin/build i handshake już PASS; potwierdzić niezmienność używanego bridge’a. Nowe handshake testują tylko przygotowanie operatora. |
| P2 | Oryginalny overlap R1 już PASS. Dodatkowy rzeczywisty overlap R2 musi wynikać z nowych przedziałów/markerów. |
| P3 | Można połączyć R1+R2, jeśli ten sam zestaw baz, workspace, namespace i paczek ma pełną ciągłość hash/provenance. Przerwa jawna. |
| P4 | Wymaga całego nowego odcinka: A waiting_user → close/resume/q1, **w czasie aktywnego B/r2**. Nie wolno zaliczać go z wcześniejszego zamknięcia obu klientów. |
| P5 | Porównać oryginalne handles Claude’a R1 z R2 w tych samych feature. Przerwa nie wymusza nowej sesji. Brak dokładnego resume pozostaje UNVERIFIED. |
| P6 | W całości nowy foreign probe i identyczny stan przed/po po obu BOOT. Starych wyników regresji nie liczyć jako real probe. |
| P7 | Verify czterech paczek, końcowe testy i limity rund można udowodnić łącznie. Oryginalnego warunku jednej ciągłej godziny v2 **nie można** udowodnić z dwóch segmentów. P7 oryginalnego v2 i status pełnego v2 nie stają się PASS. |

Raport ma oddzielić wynik przerwanego v2, wyniki brakujących ścieżek i rozliczenie
nowego 45-minutowego segmentu. Tylko nowy pełny, nieprzerwany przebieg mógłby
potwierdzić oryginalny harmonogram end-to-end; powtarzanie R1 jest poza tym zleceniem.
Nie zmieniamy definicji P7 na „sumę aktywnego czasu” ani nie usuwamy przerwy z osi czasu.

## Zatwierdzona korekta zapasu — continuation-v2 (obowiązująca)

Użytkownik zatwierdził wykonanie i następujące maksima; zastępują powyższy budżet v1,
nie zmieniają historycznych wyników. Dwie pozostałe rundy mają każda deadline_ms=2700000
(45 min) i spec.max_turns=32. MCP tool_timeout_sec=3300 (55 min); startup MCP=1200 s.
Bramka B=1500 s (25 min), okno operatora po gate-ready=1200 s (20 min), Bash=1800000 ms
(30 min), cały nowy segment=5400 s (90 min). Wynik/gotowość natychmiast zwalniają krok;
limity nie są czasami oczekiwania. B/r2 zlecić najpóźniej w 30. minucie: 45 min rundy,
10 min zapasu transportu i 5 min na dowody mieszczą się w segmencie. Nie zakładamy,
że jednoczesne wykorzystanie wszystkich maksimów gwarantuje ukończenie pracy.

Zniesiono 120-sekundowy deadline na gate-ready: przed markerem chroni deadline rundy.
PTY używa nieblokującego odczytu (timeout=0), bez ukrytego 30-sekundowego oczekiwania
na wynik modelu. Normalne zamknięcie ma maksymalnie okno operatora 1200 s, ograniczone
końcem segmentu. Limity tur Astr 3/2 pozostają planem, nie STOP; dodatkowe odczyty stanu,
resume i dokończenie review są dozwolone w czasie segmentu (prompty STATUS-A/B).
Nadal najwyżej dwa wykonania Claude’a i jedna próba foreign, bez nowych rund/retry.

Stary gate.py (540 s) i TASK.md są zachowane jako historia. Dla B przygotowywany jest
ignorowany `.pilot/gate-continuation-v2.py`, z hashem w nowym manifeście. Aktualny prompt
jawnie zastępuje stare instrukcje czasu i poleca ten skrypt z timeout=1800000.
A nadal używa natychmiastowego announce-only. W konfiguracji MCP tylko tych klientów:
BASH_MAX_TIMEOUT_MS=1800000, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1. Usuwa to domyślny
10-minutowy pułap Bash i auto-backgrounding, bez zmiany globalnych ustawień lub guardów.
[Zmienne Claude Code](https://code.claude.com/docs/en/env-vars) dokumentują te opcje;
sprawdzono też ich odczyt w lokalnym CLI 2.1.269. Native runner dziedziczy env procesu,
a jego timer pochodzi z invocation.deadline_at. Bridge 9e8f060 pozostaje niezmieniony:
obsługuje zadany deadline i max_turns=32 bez nowego builda produkcyjnego.


## Execution checkpoint: operator input STOP

Approved expanded segment used tooling79f75e0/original bridge9e8f060. Both exact
native BOOT resumes passed. Short multiline FOREIGN remained in the TUI editor:
Client awaited `[Pasted Content]`, absent for literal text. Foreign actual turns0,
new Claude executions0. A/B closed normally; waiting_user/q1 and R1 retained,
now detached generation4. Do not restart stopped relay or edit its manifest.
Scope/billing approval is recorded. Repair paste/submit without models, preferring
explicit operator submit after screen inspection, then prepare a fresh pinned tool
bundle/baseline. This is an operator blocker, not a request to recheck billing.
See final wave10-report.md section for evidence and remaining criteria/steps.


## Authorized restart after input repair

The user authorized restarting the required clients and the previously unsent foreign
probe. Preserve previous segment usage; start a new90min clock, same expanded budget.
Relay actions now separate `prompt` (paste only), `submit` (one Enter with the inspected
current screen_sha256), and `confirm` (read native rollout only). Inspect status/screen
before submit; no `[Pasted Content]` dependency. Confirm requires new task_started and
the exact prompt in the same native rollout tail. Missing confirmation locks further
input: inspect PTY/rollout/database before any decision, never resend an uncertain prompt.
Repeated confirm reads are safe and issue no model request. Wait for notify/completion
before the next product prompt. All remaining scenario steps and guards stay unchanged.
