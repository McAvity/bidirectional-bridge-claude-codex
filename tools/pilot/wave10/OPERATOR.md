# Wave10 — instrukcja operatora (nie przekazywać agentom)

Status bieżącego przebiegu: STOP po rzeczywistym R1 obu par; pilot niezaliczony.
Szczegóły i ograniczenia: docs/plans/wave10-report.md. Poniższy scenariusz nie jest
poleceniem automatycznego ponowienia zatrzymanego pilota. Nowy przebieg wymaga
ustalonego zakresu; istniejącej zgody i potwierdzenia rozliczeń nie należy ponawiać bez powodu. To dwie rzeczywiste pary Astra–Claude oraz jedna krótka sesja Astry do próby
obcego managera (bez trzeciego Claude’a). Nie jest to wcześniejszy pilot REWORK.

## Zakres do zatwierdzenia

- Astra `gpt-6-astra`, effort high; Claude: profil opus/high przypiętego runnera, bez override.
- Dwie pary, po dwie rundy: łącznie najwyżej 4 uruchomienia Claude’a, każde maks. 12 tur.
  A/r1, A/r2 i B/r1: deadline 480000 ms (8 min); B/r2: 1200000 ms (20 min).
  Tylko B/r2 ma bramkę 540 s (9 min), Bash timeout 600000 ms (10 min).
  MCP tool timeout 1320 s (22 min), startup MCP 30 s. Zero retry i dodatkowego recovery.
- Najwyżej 10 tur każdej Astry oraz 2 tury dodatkowej sesji obcego managera. Wznowienie
  dokładnej Astry A nie jest nową parą. Całość maks. 60 minut od pierwszego startu.
- Wyłącznie istniejące subskrypcje; budżet dodatkowych płatnych wywołań API = 0 USD.
  Operator przed zgodą sprawdza sposób rozliczania obu klientów. Brak takiego potwierdzenia
  blokuje start. Nie oznacza to zerowego zużycia limitów subskrypcji.
- To budżety zakresu i czasu, nie twardy miernik kosztu Astry. Operator liczy tury i pilnuje
  czasu; launcher blokuje nowe uruchomienie po 60 minutach, ale nie zabija działających sesji.
- Kontrolowany timeout, legacy adoption, host mismatch i takeover są regresjami bez modeli.
  Real pilot sprawdza równoległość, waiting_user/restart, kontynuację sesji i foreign rejection.

## Przygotowanie — terminal O (operator, bez modeli)

Wybierz nowy katalog na lokalnym filesystemie, poza checkoutem. Nie używaj bazy ani katalogu
runtime aktywnego wave7. Przypięte SHA i przygotowany katalog są podane w wave10-report.md.

```bash
export W10_SOURCE=/absolute/path/to/wave10
export RUN=/tmp/wave10-pilot-new
export W10_SHA=<runtime-commit-from-wave10-report>
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" prepare --run "$RUN" --runtime-sha "$W10_SHA"
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" preflight --run "$RUN"
```

`prepare` odmawia istniejącego katalogu. Klonuje wyłącznie branch wave10 do osobnej bazy Git,
checkoutuje detached SHA, instaluje zależności i buduje tylko `$RUN/runtime`. Tworzy syntetyczne
repo i dwa worktree `$RUN/a`, `$RUN/b`. Kopiuje wyłącznie umiejętności i materiał agenta, nie
instrukcję operatora ani ukryte fixture. Uruchamia dwa rzeczywiste serwery stdio z przypiętego
builda: initialize, tools/list, server_info, manager_status. Sprawdza oba caller/delegation,
obecność narzędzi i brak utworzenia `.bridge`. Wynik: `$RUN/handshake.json`.
Ten handshake nie uruchamia modeli i nie potwierdza metadanych prawdziwego hosta.

`preflight` sprawdza SHA, hash JS builda, czysty runtime, Node 24, dokładny host Codex 0.154.0,
obecność Claude CLI, worktree i różne klucze namespace. Nie testuje logowania modeli.
W CLI `/mcp` po starcie operator potwierdza, że `bridge` wskazuje `$RUN/runtime`, właściwe
cwd i lokalną bazę; inne aktywne konfiguracje nie mogą zastąpić tego serwera. Jeśli host lub
konto odmawia startu, STOP; nie aktualizuj hosta ani nie obchodź guardów w tym pilocie.

Zachowaj `manifest.json`, `build.log`, `handshake.json` i wersje CLI. Nie modyfikuj runtime
po przygotowaniu. `$RUN/seed` służy tylko metadanym Git; żaden agent tam nie pracuje.
Paczki mają identyczne nazwy `r1.zip`, `r2.zip`, ale osobne katalogi
`$RUN/exchange/ws_<produkcyjny-klucz-worktree>/packages`. Literalny `--output` jest celowy,
aby wszystkie zapisy przygotowania/pilota pozostały w izolowanym katalogu. Produkcyjny
resolver namespace wyznacza klucze; domyślne ścieżki `~/tmp` pokrywają regresje eksportera.

## Dopiero po zgodzie użytkownika

Zapisz zgodę w prywatnym dzienniku operatora. Skopiuj `approval.example.json` do
`approval.json`, ustaw `approved` i `subscription_only_confirmed` na `true`, zachowując
dokładny scope, runtime SHA i budżet. Sam plik nie zastępuje zgody użytkownika.
Bez niego launcher odmawia uruchomienia. Nie commituj zgody, sesji ani odpowiedzi.

## Harmonogram v2 — trzy terminale O, A, B

Bramka jest wyłącznie na początku **B/r2**. Zanim ją uruchomisz, A ma już zakończone
r1 i review oraz czeka w waiting_user/q1. W bramce mieszczą się tylko restart Astry A,
sprawdzenie tożsamości, odpowiedź q1 i start A/r2 — nie cała runda A ani jej review.
Rzeczywisty overlap workerów jest wymagany w r2; równoległość r1 jest opcjonalna.
B jest rzeczywistym workerem z aktywną próbą i poleceniem oczekującym na operatora;
nie twierdzimy, że dwa modele muszą równocześnie generować tokeny.

| Odcinek | Limit / zapas |
| --- | --- |
| Od pierwszego startu do końca r1/review obu par | Cel: 20 min; obie pary waiting_user/q1. |
| Foreign probe, gdy obie pary są nieaktywne | Cel: do 25. minuty; bez zmiany poprzednich kryteriów. |
| Start B/r2 | Najpóźniej w 30. minucie pilota; inaczej STOP bez startu rundy. |
| B/r2 do zapisania .pilot/gate-ready | Do 120 s od startu próby; inaczej STOP. |
| Gate-ready → restart A, odpowiedź q1, start workera A/r2 i zwolnienie B | Do 480 s (8 min), z 60 s zapasu przed wygaśnięciem bramki. |
| Bramka B / polecenie Bash | 540 s < 600 s; operator nie czeka do końca bramki. |
| Runda B/r2 | 120 s startu + 540 s bramki + 480 s pracy + 60 s zapasu = 1200 s. |
| MCP / cały pilot | 1320 s > 1200 s; całość 60 min, co pozostawia co najmniej 10 min po deadline B/r2 na ocenę i dowody. |

Operator pilnuje terminów także wewnątrz otwartych TUI. Nie wydłuża bramki i nie zaczyna
kolejnych rund po przekroczeniu harmonogramu. Brak gotowości do fazy r2 oznacza STOP,
nie pośpieszny restart ani dodatkowy budżet. Zakończenie rundy wcześniej zwalnia zapas czasu.

Ustaw `W10_SOURCE` i `RUN` na te same wartości w każdym terminalu (powłoki nie dzielą zmiennych).

**Terminal A**, potem wklej tylko `$RUN/START-A.txt`:

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" launch --run "$RUN" --pair a --mode start
```

**Terminal B**, potem wklej tylko `$RUN/START-B.txt`:

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" launch --run "$RUN" --pair b --mode start
```

Sprawdź `/mcp` w obu TUI. Poczekaj na zakończenie r1 i review oraz waiting_user/q1
**obu** par. Nie zamykaj jeszcze A i nie odpowiadaj na q1. Zapisz dokładne
native_thread_id z manager_status w `$RUN/session-a.txt` i `session-b.txt`.
Nie używaj newest, --last, pickera ani ID guardiana.

## Odrzucenie obcego managera — przed bramką

Obie pary czekają w waiting_user, bez aktywnych rund. W terminalu O:

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" snapshot --run "$RUN" --label before-foreign
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" launch --run "$RUN" --pair a --mode foreign
```

Trzecia Astra tylko odczytuje manager_status i próbuje create_task; delegation=deny.
Oczekiwany `MANAGER_FOREIGN_THREAD`, bez takeover/resume/retry. Zapisz odmowę i zakończ
obcą TUI. Zrób snapshot `after-foreign`; porównaj `logical.sql`, markery i owner A/B
przed/po: muszą być identyczne. SQLite WAL/SHM nie są stanem logicznym.

## Druga runda, restart A i równoległość

Przed 30. minutą pilota **w TUI B** wklej `$RUN/ROUND2-B.txt`: odpowiedź suffix `-B`,
feature_answer_user(q1), następnie B/r2 w tej samej sesji Claude’a, deadline_ms=1200000.
Pierwszą czynnością workera B jest `python3 gate.py` z Bash timeout=600000 ms.
Musi zaczekać na jego zakończenie, zanim przejdzie do implementacji. Skrypt zapisuje
`.pilot/gate-ready` i czeka do 540 s na `.pilot/continue`. R1 nie uruchamia tego skryptu.

**Terminal O:** sprawdź obecność `$RUN/b/.pilot/gate-ready` i aktywną próbę B/r2
w snapshotcie. Marker musi powstać w ciągu 120 s od startu B/r2. Zanotuj jego czas.
Od niego masz 480 s na poniższe czynności (60 s pozostaje jako rezerwa):

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" snapshot --run "$RUN" --label a-waiting-b-r2-working
```

Zamknij TUI A normalnie. **Terminal A:**

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" launch --run "$RUN" --pair a --mode resume
```

Poleć wznowionej Astrze A odczytać manager_status i feature_get. Potwierdź ten sam
native_thread_id, waiting_user i q1. Jeśli instance jest fenced po EOF/crash,
wykonaj bridge_manager_resume_instance z aktualnymi expected_epoch i expected_generation.
Nie rób takeover ani zastępczego featura/tasku.

Następnie **w tej samej TUI A** wklej `$RUN/ROUND2-A.txt`: odpowiedź suffix `-A`,
feature_answer_user(q1), A/r2 deadline_ms=480000. Pierwsza czynność workera A to
`python3 gate.py --announce-only`, która zapisuje tylko `$RUN/a/.pilot/round2-started`.
Obaj workerzy używają swoich katalogów; żaden nie zapisuje markerów w obcym worktree.

**Terminal O:** gdy marker A się pojawi, a B nadal czeka, zwolnij B niezwłocznie,
nie czekając na wynik ani review A. Nie musisz zmieścić całej rundy A w bramce B.

```bash
test -f "$RUN/a/.pilot/round2-started"
touch "$RUN/b/.pilot/continue"
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" snapshot --run "$RUN" --label r2-overlap
```

Potwierdź overlap z trwałych czasów prób i markerów, nie tylko z otwarcia terminali.
Jeśli A zdąży zakończyć krótką rundę przed snapshotem, jej zapisany przedział musi
nadal przecinać aktywną próbę B. Jeśli B przestał być aktywny przed startem A, kryterium
nie przeszło. Przy braku markerów/restartu w oknie 480 s: STOP; nie przedłużaj bramki.

## Zakończenie i dowody

Obie rundy r2: spec.max_turns=12, wbudowane zero retry, bieżący HEAD jako base,
paczki r2.zip obok r1.zip. Claude testuje, commituje i eksportuje; Astra sprawdza
wyłącznie dostawę i kończy. Bez feature_accept, dodatkowych rund i pełnego review.

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/pilot.py" snapshot --run "$RUN" --label final
```

Operator uruchamia w każdym worktree `python3 -m unittest discover -v` oraz exporter
`verify --repo "$RUN/a" --archive <dokładna-paczka> --expect-feature docs/features/F-W10-pair
--expect-purpose implementation-review --expect-base <baza-rundy> --expect-head <head-rundy>`
(analogicznie B, cztery paczki). Zachowuje logi, hashe, zakresy commitów i porównanie sesji.
Snapshot używa SQLite backup API i zachowuje logiczny dump, markery, evidence, HEAD/status
oraz hashe ZIP. Dodatkowo zachowaj `.pilot/gate-ready` B, `.pilot/round2-started` A i czas
zwolnienia B. Chronologia obejmuje restart, starty/końce prób, przekroczenia limitów i dostępne
koszty/tury. Brakujące koszty Astry to unknown, nie zero. Surowe dane zostają prywatnie.

## Kryteria i warunki STOP

| ID | PASS wymaga dowodu |
| --- | --- |
| P1 | Przypięty osobny build i dwa zaliczone handshake bez stanu przed startem. |
| P2 | Dwie realne Astry i dwa różne Claude’y; faktyczny overlap prób A/B. |
| P3 | Identyczne feature/round/package names, ale odrębne bazy, worktree, klucze, ZIP i treść PAIR. |
| P4 | A waiting_user → zamknięcie → dokładny native resume/q1, podczas aktywnego B. |
| P5 | Po r2 każda para zachowuje własną sesję Claude’a; żadnych zastępczych tasków/prób. |
| P6 | Obcy manager dostaje MANAGER_FOREIGN_THREAD; pełny logiczny stan i markery A/B bez zmian. |
| P7 | Cztery paczki verify PASS, testy obu wyników PASS, budżety i zakres zachowane. |

Natychmiast STOP przy: zmieszaniu sesji/stanu, niejednoznacznym resume, nieoczekiwanej
mutacji, host mismatch, nieprzejściu handshake, dodatkowej rundzie/modelu, końcu budżetu,
quota/auth error, timeout lub wygaśnięciu bramki B. Nie uruchamiaj automatycznego recovery,
nie resetuj baz i nie podmieniaj runtime. Zapisz snapshot i przyczynę, zatrzymaj własne
sesje w ich terminalach; ponowienie wymaga nowego zakresu/budżetu użytkownika.
Przy braku overlap/restartu podczas aktywnego B wynik jest częściowy. Jeżeli usterka wraca
trzeci raz, oceń prostszy scenariusz względem wymagania, zamiast kolejnej pełnej pętli review.
Publikuj wyłącznie zanonimizowane podsumowanie PASS/FAIL/UNVERIFIED z hashami dowodów.

## Autonomiczny operator TUI

Użytkownik może zlecić koordynatorowi całe wykonanie bez ręcznych terminali. Po takim
zleceniu nie ponawia się zatwierdzonej zgody ani kontroli paneli rozliczeń. Zgoda nadal
musi zostać zapisana lokalnie w approval.json; odpowiedzi q1 są syntetyczne.

`tui_operator.py --run "$RUN"` obsługuje prawdziwe procesy TUI przez PTY (pexpect,
pyte), a nie app-server/exec. Koordynator zapisuje atomowo numerowane JSON w
`$RUN/operator/inbox`. Dostępne czynności: start (a, b, foreign, a-resumed), prompt
(tylko przygotowany plik), trust (wyłącznie ekran własnego fixture), close, release,
stop z przyczyną. Przykład: `{"action":"start","client":"a"}`, następnie po gotowości
`{"action":"prompt","client":"a","file":"START-A.txt"}`. Koordynator autonomicznie
wybiera następny krok według powyższego harmonogramu, screen.txt, notify.jsonl i
odczytów SQLite; użytkownik nie obsługuje terminali. Relay nie podejmuje review,
nie wywołuje MCP, nie generuje tożsamości i nie odpowiada na prośby o uprawnienia.
Zwykły `/quit` czeka na wyrenderowanie polecenia przed Enter. Restart wymaga
zakończenia A i dokładnego UUID w session-a.txt. Nie ma ponownych promptów/rund.
Powiadomienia końca tury służą synchronizacji; sam koniec tury nie dowodzi review.

Przed modelami sprawdzić prawdziwe puste TUI: gotowy model/katalog, `/mcp` pokazuje
`bridge: connected (35 tools)`, `/quit` kończy proces kodem 0. Żaden prompt modelu
nie jest do tego potrzebny. Ostrzeżenie bubblewrap nie jest potwierdzeniem działającej
powłoki; faktyczna odmowa narzędzia pozostaje warunkiem STOP, bez obchodzenia.
Surowe logi PTY, ekrany, powiadomienia, zgody i UUID są tylko w prywatnym katalogu.


## Semantyka limitu tur — ustalenie z rzeczywistego R1

Nie porównuj bezpośrednio `ResultMessage.num_turns` (bridge `turn_count`) z
`--max-turns`. Limit Claude dotyczy obiegów z użyciem narzędzi, a jedna odpowiedź
może zawierać kilka wywołań i kilka komunikatów wynikowych. Strumieniowane bloki
tej samej odpowiedzi trzeba grupować po `message.id`, zachowując sesję i zakres rundy.
Nie licz ponownie bloków tekstu/thinking/tool_use o tym samym ID.

W tym przebiegu każda sesja miała 12 odrębnych odpowiedzi modelu, 11 obiegów tool-use,
17 tool_result i raportowane num_turns=18. Samo 18 > 12 było fałszywym alarmem,
nie dowodem naruszenia limitu. Sprawdź semantykę i zapis źródłowy przed nieodwracalnym
przerwaniem prawidłowej sekwencji; rzeczywisty error_max_turns, odmowa, timeout lub
udowodnione przekroczenie nadal wymagają STOP. Przy braku dowodów: UNVERIFIED.
Źródło: [Claude Code — turns and messages](https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-messages).
