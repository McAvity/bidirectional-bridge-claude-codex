# Wave10 — postęp

## Accepted integration — 2026-09-13

User instruction “zrob to” authorized acceptance of the reviewed result, integration
with wave11, joint validation and publication. Delivery `6eef24a`, closing review
`db41788`, wave11 `ed2f356`; original branches and private evidence preserved.
The authorized segmented pilot is accepted with its recorded limitations; original
uninterrupted v2 stays UNVERIFIED. No additional model run or runtime deployment.
Joint validation and publication/CI will be recorded below.


Status: **ZATWIERDZONY SEGMENT MAIN-FIRST WYKONANY / GOTOWE DO REVIEW**. R2, restart i foreign udowodnione. Pierwotny nieprzerwany v2 niezaliczony; cały wave10 nadal otwarty.

## Scope / Inputs

Autoryzacja: zlecenie użytkownika wykonania integracji, regresji i przygotowania pilota;
bez modeli/delegacji, push, merge do feature-workflow i zmiany aktywnego runtime.
Własny worktree: branch `wave10`, czysty start i plan `b040ca1ab5e9a22525671373aa7cff99e4bd7dfe`.
Izolacja: `66e524f0e334b159ccd5fb3cd3606bf58e858a68`.
Timeout/recovery: aktualny `feature-workflow` = `b040ca1ab5e9a22525671373aa7cff99e4bd7dfe`.
Wspólna baza: `aeb92c2f35670b73aa9e204f68f3734d2ad2cc37`.

## Jedna lista istotnych ustaleń

| ID | Ustalenie | Status / sprawdzenie |
| --- | --- | --- |
| W10-01 | Historia wave7 zawiera prywatne ścieżki operatora i namespace rzeczywistego worktree oraz identyfikatory runtime. | Zamknięty: import oczyszczonego snapshotu bez przodków wave7; mapowanie wszystkich 32 commitów. Metadane author/committer mają publiczny noreply, brak wykrytych linków sesji/sekretów. |
| W10-02 | Wave7 bazuje na kodzie sprzed timeout recovery; zastąpienie plików cofnęłoby opublikowane recovery. | Zamknięty: trzystronne połączenie; konflikty control-plane (lazy services + evidence) i tools (guard + budget) rozwiązane. Regresja FAILED/TIMEOUT przez dispatcher z restartem, takeover, foreign replay i no-mutation przechodzi. Pełne testy: 425 JS / 29 exchange / 115 pilot tooling PASS. |
| W10-03 | Pilot wymaga wspieranego Codex0.154.0 i prawdziwego kontekstu wywołań. | Zamknięte: prawdziwe TUI, native metadata, exact resume i foreign guard potwierdzone w main-first; szczegóły i granice w raporcie. |
| W10-04 | Opublikowany test stdio timeout nie przekazywał nowego kontekstu native; create odrzucony przed mutacją. | Zamknięty: harness ma native metadata i jawne resume_instance po EOF; 8/8 stdio i pełne 425/425 JS PASS. |
| W10-05 | Nazwa operator.py przesłaniała moduł standardowy Python przy bezpośrednim starcie CLI. | Zamknięty: pilot.py i test subprocess --help PASS. Pierwsze prepare zatrzymane przed utworzeniem katalogu. |
| W10-06 | Kontrola instrukcji ujawniła max_attempts spoza schematu feature_run oraz skrócone expect-feature eksportera. | Zamknięty: wbudowane zero retry i pełna ścieżka docs/features/F-W10-pair; finalne prepare oraz export/verify obu fixture PASS. |
| W10-07 | Test przenośności odrzuca także wzmiankę wave6 w tools/pilot. | Zamknięty: neutralna wzmianka o wcześniejszym pilocie REWORK; 115/115 testów PASS. |
| W10-08 | Bramka B/r1 180 s nie obejmowała rundy A 480 s oraz review/restartu. | Harmonogram v2: bramka wyłącznie B/r2, po r1/review obu par; 540 s bramki, 480 s operatora, B/r2 1200 s, MCP 1320 s, całość 60 min. Zamknięty: 9 testów narzędzia + portability PASS; nowy pin 406f0e1, build, dwa handshake i preflight PASS. |

| W10-09 | Transport wejścia TUI zależny od renderowania wklejki. | Zamknięte poprawką4f32170: jawne paste/submit/confirm, 30 regresji oraz140 wszystkich testów pilota PASS. Rzeczywiste długie BOOT i krótkie FOREIGN przyjęte z natywnym potwierdzeniem, bez resend. |
| W10-10 | Sukcesowe num_turns nie jest licznikiem limitowanym przez max_turns. | Wyjaśnione; runner egzekwuje max_turns32 dla R2. Obie R2 COMPLETE, bez porównywania telemetrii10/13 z limitem pętli. |

| W10-11 | Niedookreślony spec foreign pozwolił wybrać niepoprawne scope.paths=[]. | Zamknięte d7cdbb0: dokładny JSON, niepuste paths, walidacja realnego Zod bez handlera; rzeczywista pierwsza próba main-first MANAGER_FOREIGN_THREAD, pełny stan przed/po identyczny. Historyczne -32602 zachowane jako błąd przygotowania. |

| W10-12 | Kontrakty R2 obu Astr miały początkowo objective ponad2000 znaków. | Skorygowane przez Astry po INVALID_ARGUMENT i potwierdzeniu braku task/attempt; każde R2 uruchomione dokładnie raz. To poprawka przed wykonaniem, bez retry workera ani nowej rundy. |

## Validation / Handoff

Potwierdzono własny worktree i oba źródła; przejrzano metadane oraz patche wszystkich
32 commitów wyłącznych wave7. Sandbox wykonania nie startuje (bwrap loopback);
komendy lokalne wykonywane przez zatwierdzaną eskalację. Następnie oczyszczony import,
rozwiązanie konfliktów i testy. Niezależne review nieuruchomione zgodnie z zakazem delegacji.

## Import i walidacja — checkpoint 1

Import snapshotu accepted wave7, bez jego prywatnych przodków. Historyczne ledgery
zachowane z redakcją katalogu domowego operatora i rzeczywistego klucza namespace.
Nie importowano delty `docs/HANDOFF.md`, `docs/plans/wave7.md` ani
`docs/tasks/timeout-recovery/*`: aktualne opublikowane wersje pozostają nadrzędne.
Mapowanie 32 źródłowych commitów na commit integracji zostanie zapisane w raporcie.
Źródłowe SHA i hashe historycznych paczek w ledgerach odnoszą się do oryginałów,
nie do oczyszczonych bajtów; oryginalny branch zachowany.

`npm ci --ignore-scripts`: PASS (Node 24.15.0; npm zgłasza 5 istniejących podatności,
4 moderate / 1 high; aktualizacja zależności poza zakresem). Build: PASS.
Nowa regresja timeout przez MCP: PASS. Pierwsza wersja atrapy rzucała INTERNAL po
abort; dostosowana do zwrotu PARTIAL przez runner po deadline. To korekta fixture,
nie stwierdzona usterka produkcyjna. Wymagane pełne zestawy testów uruchomione.

## Checkpoint 2 — pilot i pełna walidacja

Integracja: `2c9e9ddbb909b3db9f065466d60152a79316b31f`.
Lokalny kandydat `320ce4700ca9048565710535093515d98993a300` zastąpiony tym SHA
przez amend po redakcji 11 identyfikatorów historycznych runtime. Nie jest przodkiem
wyniku; źródłowe branche nienaruszone. Finalny przegląd prywatności obejmuje również
te identyfikatory, a nie tylko ścieżki/linki/sekrety.

Pełne testy: build PASS; JS 425/425; Python exchange 29/29; pilot tooling 114/114
(w tym 4 nowe testy odmowy przekroczenia budżetu, brakującej sesji i nadpisania dowodów).
Środowisko: Node 24.15.0, Python 3.12.3 (nie 3.11). Dane wyłącznie syntetyczne.
Przygotowano tools/pilot/wave10: pilot.py, handshake.mjs, OPERATOR.md.
Następnie osobny detached runtime i dwa worktree w nowym /tmp, rzeczywisty start/handshake
MCP bez modeli. Nie naprawiać startowego MCP tej sesji — jawna instrukcja użytkownika.

Przygotowanie na `e099ca5414bdedb0fa7143ecca986a93f2d95361`: osobny build PASS,
dwa równoległe rzeczywiste handshake stdio PASS (35 narzędzi każdy), no-state PASS,
preflight PASS, snapshot prepared PASS. Modele nieuruchomione. Kontrola dokładnych
argumentów protokołu operatora W10-06 wymaga nowego finalnego pinu; poprzedni katalog
zostaje zachowany, nie jest używany do startu modeli.

## Historyczny handoff przed korektą harmonogramu — nie do startu

Finalny runtime pilota: `88bccc71d7e5e72ec1daeaf13922615aa28fab60`, detached w
`/tmp/wave10-pilot-88bccc7/runtime`; worktree `/tmp/wave10-pilot-88bccc7/a` i `b`.
Przygotowany od zera w osobnym repo Git, bez modyfikacji metadata/worktree wave7.
Dwa rzeczywiste równoległe handshake MCP PASS, 35 narzędzi każdy, caller codex,
delegation allow, brak stanu/DB. Preflight, prepared snapshot i syntetyczny export/verify
obu fixture PASS. Nie ma approval.json; nie uruchomiono modeli. Poprzednie katalogi
przygotowania zachowane; do startu wskazany wyłącznie finalny katalog powyżej.

Końcowe kontrole: 425 JS / 29 exchange / 115 pilot tooling PASS; git diff --check PASS.
Wszystkie 32 źródłowe commity oraz kandydat 320ce47 nie są przodkami wyniku; branche
wave7 i feature-workflow zachowały przypięte SHA. Brak push/merge/deploy/zmiany aktywnego runtime.
Nie wykonywano niezależnego review ani pełnego ponownego review accepted featura.
Żaden konkretny problem nie wrócił trzeci raz; poprawki kontrolowano wobec tabeli powyżej.

Raport, mapa SHA, hashe dowodów, ograniczenia i dokładny skrypt terminali:
[wave10-report.md](wave10-report.md). Ostatni commit jest dokumentacyjny; nie zmienia
przypiętego runtime ani launchera. Następny krok: review integracji i zatwierdzenie przez
użytkownika zakresu/budżetu pilota. To nie zamknięcie całego wave10.

## Korekta harmonogramu po przeglądzie koordynatora

Wejście: `b05624d9e93baef5c6f249a386429002b537ab19`, branch wave10, czysty worktree.
Koordynator zgłosił brak nowych problemów integracji oraz niezależny PASS 36 testów
izolacji/recovery/launchera i preflight. Nie powtarzamy review implementacji ani jej pełnych testów.
Autoryzacja bieżąca obejmuje tylko harmonogram, instrukcję, budżet i nowe przygotowanie.

W10-08: r1 obu par kończy się review i waiting_user. Foreign probe odbywa się wtedy,
bez aktywnych workerów. Dopiero B/r2 rozpoczyna bramkę, w której operator restartuje A,
przekazuje odpowiedź i uruchamia A/r2. Release B po markerze startu A, nie po wyniku A.
Gate 540 s < Bash 600 s; start B do gate-ready 120 s + gate 540 s + praca 480 s
+ zapas 60 s = deadline B/r2 1200 s < MCP 1320 s. Pozostałe rundy 480 s.
B/r2 start najpóźniej w 30. minucie; pilot 60 min. Okno operatora 480 s daje 60 s rezerwy.
4 rundy / 12 tur każda; do 10 tur Astry na parę + 2 foreign probe; zero retries,
zero dodatkowych płatnych wywołań API, wyłącznie potwierdzone subskrypcje. Budget/scope v2.

Walidacja zmienionego narzędzia: 9/9 testów, portability 1/1, git diff --check PASS.
Następnie nowy lokalny pin i nowy katalog przygotowania, build oraz 2 handshake/preflight.
Żadnych modeli, bridge delegacji, push, merge ani zmian aktywnych runtime.

## Punkt wznowienia — harmonogram v2

Commit korekty i pin nowego runtime: `406f0e1eb9e0ed494207589a82665bfd83741b1d`.
Nowy katalog **`/tmp/wave10-pilot-406f0e1`**, detached runtime w `runtime`, osobne worktree
`a` i `b`. Poprzednie katalogi zachowane i nieużywane do startu. Build npm ci/build PASS;
2/2 rzeczywiste równoległe handshake MCP PASS, po 35 narzędzi, no-state PASS;
preflight i prepared snapshot PASS. Prompty START-A/B nie mają bramki r1,
ROUND2-A/B mają właściwe deadline i markery. Manifest scope/budget v2 zgodny.
9 testów zmienionego narzędzia i 1 test przenośności PASS; git diff --check PASS.
Kod bridge’a niezmieniony (ten sam hash builda 744d0008…725d8da3), bez ponownego
pełnego review/testów zaakceptowanej implementacji. Wyniki 36 testów koordynatora
są informacją z jego przeglądu, nie nowymi uruchomieniami tej sesji.

**Następna czynność:** użytkownik zatwierdza konkretny budżet v2 z raportu, potem operator
zapisuje approval.json i uruchamia pilot według OPERATOR.md. Jeszcze nie ma zgody,
modeli ani baz pilota. Start r1 obu par → review/waiting_user obu → foreign probe →
B/r2 gate-ready → zamknięcie/resume A → A/r2 started → release B → wyniki/dowody.
Nie czekać na wynik A/r2 przed release. B/r2 start do 30. minuty; 480 s na działania
operatora, 540 s gate, 600 s Bash, 1200 s B/r2, 1320 s MCP, 60 min całości.
Ostatni commit dokumentuje ten punkt wznowienia; nie zmienia pinu. Bez modeli, push,
merge ani zmian aktywnych runtime. Cały wave10 pozostaje otwarty.

## Autonomiczny pilot — przygotowanie operatora

Aktualne zlecenie użytkownika zatwierdza modele, budżet v2 i rozliczanie na jego
kontach oraz automatyczną obsługę operatora. Nie wymaga kolejnych kontroli opłat.
W10-09 (otwarte, dowody wykonania): operator TUI w PTY, bez zastępowania decyzji Astr,
z lokalnym dziennikiem, usunięciem odziedziczonego ID rodzica, ograniczeniem promptów,
normalnym quit/resume i limitem całości. 13 testów narzędzi bez modeli PASS.
Bezmodelowe próby harnessu wykazały, że początkowy znak zachęty nie oznacza gotowości,
a Enter musi następować po wyrenderowaniu tekstu. Używamy obserwacji ekranu,
nie czasowych założeń. Kod bridge’a i aktywne runtime nie zostały zmienione.
Po commicie operatora obowiązuje świeży katalog i osobny przypięty build.

W10-09: pin operatora `19ad974` zbudowany w świeżym katalogu, 2 handshake i preflight
PASS. Prawdziwe TUI uruchomione, lecz przygotowane prompty pozostały w edytorach:
Codex 0.154.0 renderuje `Pasted Content`, a relay oczekiwał `Pasted text`.
Zatrzymano przed wysłaniem do modeli (brak workerów/rounds). Upraszczamy warunek
renderowania do faktycznego markera przypiętego hosta i sprawdzamy samo wklejenie
bez wysyłania przed kolejnym świeżym pinem. Nie jest to retry modelu ani pilot PASS.

Dowód granicy przygotowania: oba ekrany zachowały niewysłany `Pasted Content`, brak
rolloutów dla obu cwd i brak `.bridge` w obu worktree; snapshot zachowany lokalnie.
Nie powstały sesje managerów ani Claude’a, więc korekta przygotowania nie zastępuje
istniejącej sesji ani nie ponawia modelowej rundy. Test regresji rzeczywistego PTY
potwierdza Enter dopiero po markerze oraz licznik dopiero po wysłaniu (14 testów PASS).
Następny świeży pin nie używa zatrzymanego katalogu przygotowania.

## Wynik autonomicznego przebiegu — STOP po R1, nie zaliczony pilot

Runtime `9e8f060c606f88ebf55f8a4cb1e63740691221fd`, osobny katalog
`/tmp/wave10-pilot-9e8f060-auto`. Build, dwa handshake MCP i preflight PASS;
14 testów narzędzi PASS. Dwie prawdziwe Astry TUI i dwóch Claude’ów wykonały R1.
Oba bindingi potwierdzone native turn-metadata hosta 0.154.0; workerzy mieli
74.394 s rzeczywistego overlap. Obie Astry wykonały własne review i zakończyły
po jednej turze w waiting_user/q1. Obie paczki r1 verify PASS; testy A 5/5, B 3/3.

W10-09: poprawka transportu sprawdzona; rzeczywiste wysłanie promptów i odbiór
notify działały. Natywnego resume ani automatyzacji faz r2 nie zaliczono.
W10-10 (otwarte — błąd oceny operatora): obie Astry zgłosiły num_turns=18 przy
max_turns=12. Koordynator przedwcześnie uznał to za warunek STOP i zamknął obie
Astry przez /quit, zanim sprawdził semantykę licznika.
Dalszy odczyt dowodów: każda sesja ma 12 różnych message.id odpowiedzi modelu,
11 obiegów tool-use i 17 tool_result. Dokumentacja Claude rozróżnia obiegi od
komunikatów; `num_turns > max_turns` nie dowodzi tu przekroczenia budżetu.
Nie wykazano błędu integracji ani przekroczenia limitu. Przyczyną nieukończenia
jest przedwczesny STOP operatora, nie odmowa konta ani guard bridge’a.

P1 PASS; P2 PASS; P3 UNVERIFIED (izolacja r1 potwierdzona, r2 brak);
P4–P7 UNVERIFIED. Brak foreign probe, restartu A podczas B/r2, r2 i dwóch paczek.
Nie uruchomiono ponownie klientów: dodatkowy restart B zmieniałby scenariusz.
Dwie rundy Claude’a z czterech, po jednej turze Astry, zero foreign/retry/recovery;
381.31 s od startu klientów do końca operatora. Procesy własnego runtime zakończone.

Punkt wznowienia: czytać końcową sekcję wave10-report.md. Zachować oba katalogi
przygotowania i wszystkie dowody. Nie kontynuować automatycznie pozostałych kroków
w zatrzymanym katalogu. Najpierw rozstrzygnąć sposób dalszego pilota po nieplanowanym
zamknięciu B; w tej sesji nie wydajemy pozostałego budżetu ani nie tworzymy zastępczych
sesji. Instrukcja operatora wyjaśnia już semantykę tur. Cały wave10 pozostaje otwarty;
bez push, merge i zmian runtime/worktree innych fal.

Końcowa walidacja: 14 testów operatora PASS, 5 testów przenośności PASS,
git diff --check PASS. Bez bibliotek opcjonalnych pexpect/pyte moduł testów TUI
jawnie SKIP zamiast błędu importu w bazowym CI; z bibliotekami wszystkie 5 testów TUI
wykonane. Zmieniono tylko discovery testu i dokumentację po zatrzymaniu; runtime
realnego przebiegu nadal pin 9e8f060, bez zmian narzędzi przygotowania/builda.
Przegląd nowych linii: brak natywnych UUID, adresów kont i prywatnych ścieżek domowych.

## W10-10 — przygotowanie kontynuacji po zachowanym R1

Wejście `1c6e635`, własny branch/worktree wave10; bez modeli i bez ponownego review integracji.
Sprawdzono dokładny binarny CLI 2.1.269: sukcesowy num_turns liczy 1 + komunikaty user
(17 tool_result w każdej sesji), limit pętli jest osobny i emituje max_turns_reached /
error_max_turns. Gałąź błędu może raportować inny licznik. Nie zamieniamy 18 na 11;
11 to grupy odpowiedzi zawierające tool_use, 12 to wszystkie różne odpowiedzi.
Błędny STOP był oceną koordynatora, nie if-em starego relay. Nowe prompty wycofują tę
regułę; nowy kontroler pozostawia limit runnerowi i przerywa na faktycznym FAILED.

Bazy quick_check OK, waiting_user/q1 bez odpowiedzi, po 1 COMPLETE; manager detached,
epoch 1/generation 2, brak aktywnej instancji. Pliki session zgadzają się z bindingami,
po jednym dokładnym rolloucie TUI i transkrypcie Claude’a; oba worktree czyste.
Resume nadal UNVERIFIED — nie uruchomiono klientów ani manager_resume_instance.

Dodano continuation.py: odczytowy audit/manifest, osobny approval i zegar, dokładne
resume A/B, drugi resume A podczas B, tylko dwa prompty ROUND2 i jeden foreign.
Oryginalne zegar, approval, bazy, build i pakiety zachowane. 23 testy operatora PASS,
w tym regresja braku fałszywego STOP dla success 18/max12 i STOP dla FAILED/zmiany sesji.
Scenariusz, semantyka i budżet: tools/pilot/wave10/CONTINUATION.md. Do zatwierdzenia:
2 rundy Claude max12 (A 8 min/B 20 min), A 3 tury, B 2, foreign 1; segment 45 min.
P1–P6 można oceniać przy zachowaniu wymaganych dowodów; P4 musi zajść na nowo w czasie
B/r2. P7 oryginalnego nieprzerwanego v2 nie może stać się PASS przez sklejenie segmentów.

Punkt wznowienia kontynuacji: pin narzędzi c136c7d, świeży pomocniczy build
/tmp/wave10-continuation-c136c7d; build, dwa handshake, preflight PASS. Przygotowany
manifest w continuation/ wiąże oryginalny pilot i runtime9e8f060; SHA-256 manifestu
9ec2c2a18ee64739b1acd1eac14c87380d60eb441bf4e60b281c074c0d177931.
Audit przed/po i ponowny preflight identyczne; właściwe approval.json i operator/
nie istnieją. 23 testy narzędzi oraz 5 wybranych regresji runnera PASS. BuildArgs
potwierdza konkretny limit12 i exactresume bez tworzenia procesów. W10-10: wyjaśnienie
liczników i poprawka operatora gotowe; rzeczywista kontynuacja oczekuje decyzji o
nowym scope/budżecie. Nie zmieniono starego zegara, approval, baz ani runtime.
Dokładne kroki/budżet/kryteria: końcowa sekcja wave10-report.md i CONTINUATION.md.

Końcowa korekta przygotowania: także FOREIGN.txt ma teraz jawnie wielowierszowy format,
jak sprawdzona rzeczywista ścieżka wklejania R1. Nie dodajemy kolejnej heurystyki TUI.
24 testy PASS, w tym przygotowanie wszystkich promptów tą samą ścieżką. To poprawka
przed modelami; zestaw c136c7d zachowany jako wcześniejsze przygotowanie, następny pin
narzędzi i manifest zastąpią go do startu. Oryginalny pilot/runtime pozostają bez zmian.

Ostateczny punkt startu przygotowania: pin 51c358a02304b7fcbbfbe93978878bd4923fec2f,
/tmp/wave10-continuation-51c358a/continuation. Manifest SHA-256 dbaa515e61f4c1dde90fb677a2d3b8e60bb8db72407771c53d2d45b7347771ec.
Build, 2/2 handshake i odczytowy preflight PASS. Baseline starego pilota identyczny
z poprzednim odczytem c136c7d. 24 testy operatora, 5 runnera i 5 przenośności PASS.
Zestaw c136c7d zachowany jako historyczne przygotowanie; nie używać go do startu.
Approval i operator nowego segmentu nie istnieją. Stan: KONTYNUACJA PRZYGOTOWANA
DO ZATWIERDZENIA; resume/modelowy segment pozostają UNVERIFIED.

## Kontynuacja v2 — zatwierdzony większy zapas i wykonanie

Wejście 319b49f. Użytkownik zatwierdził autonomiczne wykonanie bez kolejnej zgody:
2 rundy Claude po 45 min / max_turns32, MCP55 min, operator20 min, gate25 min,
Bash30 min, segment90 min. Tury Astr są planem; nadal tylko2 wykonaniaClaude i1foreign.
Zidentyfikowano i usunięto krótsze ograniczenia przygotowania: gate540 s, Bash10 min,
gate-ready120 s, PTYlimit10tur, close20 s. Runtime9e8f060 i globalne limity runnera
niezmienione. Nowy ignorowany skrypt bramki B; aktualne prompty zastępują stare czasy.
MCP env lokalnie podnosi BASH_MAX_TIMEOUT_MS i wyłącza auto-backgrounding; timeout
runnera bierze invocation.deadline_at. Scope continuation-v2, nowe90minokno i approval.


### Wynik zatwierdzonej kontynuacji v2 — STOP na W10-09

Przygotowanie: 34bd367 (timeouty), 79f75e0 (TOML overrides MCP env). Build79f75e0,
2/2 handshake, preflight i26 testów operatora PASS. Oryginalny bridge9e8f060
niezmieniony. Rzeczywiste MCP miały Bash max1800000 i background disabled.
Zgoda zapisana lokalnie: Claude2x45min/max32, MCP55min, operator20min, gate25min,
Bash30min, segment90min; tury Astr tylko planem.

Dwie prawdziwe Astry wykonały po1 BOOT: exact native resume, manager resume
z epoch1/generation2 do3, waiting_user/q1 unanswered. Foreign TUI uruchomiony,
ale literalny krótki prompt nie wyzwolił Enter. Requested foreign=1, faktyczne
tury foreign=0. Claude R2=0. Automatyczna kontrola dopuściła próbę po sprawdzeniu
kontraktu testu w katalogu A; bieżąca blokada dotyczy wyłącznie transportu TUI.

Zgodnie z warunkiem błędu STOP bez retry. A/B normalnie zamknięte, foreign
z niewysłanym wejściem zakończony wraz z relay. Końcowo epoch1/generation4,
active_instance_id=null, quick_check obu baz OK, waiting_user/q1 unanswered,
po1 historycznej COMPLETE, paczki R1 identyczne, brak własnych procesów MCP.
Nowe tury A1/B1, Claude0, foreign0; segment około9min. Surowe dowody lokalnie
w /tmp/wave10-continuation-79f75e0/continuation/evidence i operator/.

W10-09 powróciło mimo wymuszenia wielowierszowości. Prostszy następny krok:
oddzielne paste i jawny submit operatora po odczycie ekranu, bez kolejnej
heurystyki etykiet. Nie wdrożono poprawki w aktywnym zestawie ani retry.
Nie restartować starego relay/manifestu. Najpierw poprawka bez modeli i świeży
pin/baseline generation4; bez powtarzania R1. Szczegóły w końcu raportu.


### W10-09 — jawny submit i autoryzowane wznowienie po blokadzie

Wejście0004dee. User zatwierdził restart klientów i niewysłany foreign; nadal tylko
2 wykonaniaClaude, większe limity, nowe90minokno. Rozdzielono paste/submit/confirm:
Enter raz po inspekcji aktualnego ekranu, potwierdzenie przez nowy task_started
oraz dokładny prompt w natywnym rolloucie. Nie używamy etykiety wklejki. Niepewne
przyjęcie blokuje resend; confirm to tylko odczyt. Manifest przypina też hash relay.
30 testów bez modeli PASS, także opóźniony prawdziwy PTY, krótkie/wieloliniowe
wejście, brak potwierdzenia i odrzucenie historycznego dopasowania. Następnie
świeży przypięty pomocniczy build/handshake; bridge9e8f060 pozostaje niezmieniony.


### Segment po poprawce4f32170 — relay PASS, probe schema STOP

Świeży zestaw /tmp/wave10-continuation-4f32170: build,2/2 handshake, preflight PASS;
bridge9e8f060 bez zmian. Zgoda na restart i nowe90min zapisana lokalnie. Zachowane
A/B wznowione dokładnie; BOOT po1 turze, generation4→5. Jawny submit krótkiego
FOREIGN i natywne task_started+prompt potwierdzone. To rzeczywisty dowód naprawy
W10-09. Bez ponownego promptu, opóźnienie nie wywoływało retry.

Foreign wykonał1 status i1 create_task, z pustym scope.paths. MCP zwrócił-32602
(minimum1 element), guard tożsamości nieosiągnięty. Astra zakończyła bez retry.
Snapshoty cont3-before-foreign/cont3-after-foreign identyczne: bazy, logical.sql,
owner, workspace marker, git i paczki. P6 niezaliczone. STOP zgodnie z wcześniejszym
warunkiem błędu i limitem1 próby; nie wykorzystano dwóch rund Claude’a.

Klienty normalnie zamknięte; finalnie epoch1/generation6, detached, quick_check OK,
po1 historycznej COMPLETE, waiting_user/q1 unanswered, brak własnych procesów MCP.
Nowy segment255.103s: A1/B1/foreign1/Claude0. Poprzedni segment zachowany osobno:
A1/B1/foreign0/Claude0. Historyczne R1 niezmienione. Wszystkie140 testów pilota PASS.
Brakujące kroki nadal opisane w raporcie. Bez modeli/retry w ramach dalszego zapisu.


### Main-first — autoryzowana zmiana kolejności i dwóch prób foreign

Wejście1edd024. Główny scenariusz R2/restart przed niezależnym foreign; nowe90min,
2 Claude45min/max32 bez powtarzania R1, do2 foreign. Przygotowano dokładne argumenty
create_task z niepustym scope.paths oraz bezmodelowy walidator realnego Zod schema
z bridge9e8f060: valid PASS, empty_paths rejected,0 handlerów.30 regresji PASS.
Brak zmian ogólnego relay; zachowujemy jawny submit/confirm. Świeży pin i manifest
odczytają generation6. Naprawialny błąd jednego scenariusza wymaga oceny wpływu;
nie jest automatycznym zakazem pozostałych niezależnych kroków.


Main-first w toku (pin d7cdbb0): świeży build,2/2 handshake, preflight PASS.
Dokładne BOOT A/B generation6→7. B poprawiła zbyt długi objective po jednoznacznym
INVALID_ARGUMENT przed utworzeniem zadania; brak pierwszego wykonania workera.
Następnie jedno B/r2 w tej samej sesji, aktywna bramka. A normalnie zamknięta,
exact resume generation8→9 i waiting_user/q1 potwierdzone podczas aktywnego B.
Jedno A/r2; oba workery aktywne. Release po0.139s od markera A, bramka B267.682s.
Snapshoty main-b-active-a-waiting, main-a-resumed-b-active, main-r2-overlap oraz
lokalny release-observation zachowane poza Git. Czekamy na dostawy i review;
nie oznaczamy jeszcze verify4 ani foreign PASS.


### Main-first zakończony — wynik końcowy

Pin przygotowania d7cdbb0; produkcyjny bridge9e8f060 niezmieniony. R2 A/B COMPLETE,
77.708s overlap, same Claude handles i natywne sesje. R1/poprzednie prefiksy logów
nienaruszone. A/r2 commit7cc6628928318c4677752c83eeeb64cffef80e68;
B/r2 e50dc4d8ebd777ba4b0b88b38faf0dee180b4a66. Review rzeczywistych Astr PASS,
verify4 PASS, końcowe testy A6/B3 PASS, czyste worktree.140 testów operatora PASS.

Po zakończeniu obu workerów osobny foreign: dokładny zwalidowany JSON,1 status
+1 create_task, MANAGER_FOREIGN_THREAD. Bazy, logical.sql, owner, workspace marker,
markery bramki, Git i paczki obu par identyczne przed/po. Druga próba nieużyta.
Normalne zamknięcie wszystkich klientów; finalnie A generation10/B8, epoch1,
detached, awaiting_review, q1 odpowiedziane syntetycznie, brak aktywnych workerów/MCP.

Nowy segment868.526s (14min29s): Astra A3/B2, foreign1/2, Claude2/2; żadnego retry
wykonanego workera, recovery, zastępczej pary, push/merge. P1–P6 PASS z opisanymi
łącznymi/nowymi dowodami; P7 verify/testy/budżet nowego segmentu PASS, ale pierwotny
nieprzerwany v2 pozostaje UNVERIFIED. Nie deklarujemy ukończenia całego wave10.

Punkt wznowienia: nie uruchamiać ponownie zakończonego serve ani rund. Lokalny
zestaw /tmp/wave10-main-first/continuation/evidence zawiera final-audit, final-checks,
timing-summary, telemetry, release-observation i foreign-comparison; surowe dane
poza Git. Następny krok to review raportu/odbiór, nie dalsze wykonanie modeli.
Historia przerw i dokładne kryteria w końcowej sekcji wave10-report.md.


## Coordinator closing review — 2026-09-12

PASS recommendation for the explicitly authorized segmented pilot and integration
at `6eef24a`; this is not user acceptance, merge, publication or deployment.
Focused review only: operator corrections since `b05624d`, final evidence and
compatibility with accepted wave11 `ed2f356`. No new product blocker found.

Independent checks:
- All 65 indexed local evidence files match their recorded SHA-256.
- All 15 files in the before/after foreign snapshots compare byte-for-byte equal.
- Final audit records exact prepared arguments, a distinct native foreign manager,
  MANAGER_FOREIGN_THREAD, stable native manager/Claude sessions and healthy databases.
- Final checks contain four passing package verifications, unchanged R1 archives,
  A 6/6 and B 3/3 tests; timing records show 77.708 seconds of R2 overlap.
- Targeted operator tests independently rerun: 30/30 PASS.
- Git merge-tree of wave10 and wave11 succeeds without conflicts. Inspected combined
  bridge-loop retains namespace, timeout recovery and the new focused-review and
  step-back rules. This is a compatibility preview, not validation of a deployed merge.

P1-P6 and the authorized segment's checks/budget support PASS. Original uninterrupted
v2 remains UNVERIFIED; no rerun is recommended solely to change that historical fact.
No empirical claim about 75/90-minute execution, general unattended reliability or
completion of the older wave6 REWORK scenario follows from this small pilot.

Next: user acceptance of this result, integration with wave11 and joint validation,
then publication/CI. Preserve the existing pinned runtimes and private evidence.
No models, source fixes, merge, push or runtime rebuild performed in this review.

Joint validation (isolated worktree): npm ci --ignore-scripts, build, 425 JS,
29 exchange and 140 pilot-tool tests PASS; documentation check 90 files PASS;
git diff --check clean. No paid models. Publication/CI follows this checkpoint.
