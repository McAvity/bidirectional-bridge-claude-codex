# OPERATOR — test korekty (REWORK → poprawka)

Dokument dla operatora i użytkownika. **Nie wklejaj go Astrze.** Projekt, uzasadnienie i
kryteria: `PLAN.md`. Oczekiwany przebieg i czerwone flagi: `operator/EXPECTED.md`.

Katalogi:
- `rework/agent/` — materiał, który trafia do agentów: repo testowe i przypadki właściciela;
- `rework/operator/` i `common/` — narzędzia operatora;
- katalog przebiegu (`$RUN`) — tworzony poza checkoutem; dowody operatora trafiają do
  `$RUN/operator-results/`.

Potrzebne są dwa okna:
- **Terminal A (operator)** — polecenia powłoki: preflight, migawki, ingerencja, zbieranie wyników.
- **Terminal B (TUI Astry)** — Codex. Wpisujesz tu tylko trzy rzeczy: `/mcp`, blok startowy i
  jedną prośbę w kroku 4.

W Terminalu A ustaw zmienne (ścieżki własne; katalog przebiegu poza checkoutem):

```bash
export BRIDGE=/ścieżka/do/checkoutu/bidirectional-bridge-claude-codex
export RW=$BRIDGE/tools/pilot/rework
export RUN=/ścieżka/poza/checkoutem/rework-run-1
export CODEX_PROFILE=...            # tylko jeśli używasz nazwanego profilu Codexa
```

## 0. Przygotowanie i preflight — Terminal A (kilka minut, bez płatnych agentów)

```bash
cd $BRIDGE && npm ci --ignore-scripts && npm run build     # raz dla checkoutu
python3 $RW/operator/setup_rework.py --dest $RUN            # nowe repo testu; odmawia, gdy katalog istnieje
python3 $RW/operator/preflight_rework.py --run $RUN         # oczekiwane: PREFLIGHT OK
```

Każde podejście to nowy katalog `$RUN`. Nie czyść ani nie resetuj używanego.

## 1. Start Astry

**Terminal B:**

```bash
PILOT_DIR=$RUN $BRIDGE/tools/pilot/common/astra.sh start
```

**TUI (Terminal B):**
1. Wpisz `/mcp`. Musi być widoczny serwer `bridge` z narzędziami `bridge_*`.
2. Wklej całą zawartość `$RUN/START-ASTRA.txt` (setup wstawił do niej ścieżki tego przebiegu).

**Terminal A:**

```bash
python3 $RW/operator/collect_rework.py snapshot started --run $RUN
```

## 2. Faza 1 — nie ingeruj

Czekaj na powiadomienie o końcu tury Astry. Zdarzenie trafia też do `$RUN/logs/codex-notify.jsonl`.
Orientacyjnie trwa to 5–15 minut. Nie wpisuj niczego w TUI. Oczekiwane zakończenie tury: raport,
że review T01 dało PASS, z dowodami, bez pytania o akceptację.

Jeśli tura skończy się inaczej (pytanie, blokada, zatrzymanie), przejdź do sekcji 6.

## 3. Ingerencja testowa — Terminal A (tylko po końcu tury z raportem)

Nie przerywaj Astry (Esc/Ctrl+C). Ingerencja wymaga tury zakończonej normalnie (`complete`).

```bash
python3 $RW/operator/collect_rework.py snapshot phase1-done --run $RUN
python3 $RW/operator/inject_regression.py --run $RUN --dry-run     # sprawdzenie warunków; nic nie commituje
python3 $RW/operator/inject_regression.py --run $RUN --repo-quiescent        # commit pilot-teammate + INJECTION.md
```

`--repo-quiescent` to Twoje potwierdzenie, że repo testu jest zatrzymane: tura Astry się
skończyła, żadna runda nie trwa, a Ty ani żadne narzędzie (edytor, IDE, skrypt) nie zapisuje w
repo testu. Bez tej flagi prawdziwa ingerencja jest odrzucana (dry run jej nie wymaga).

Co robi skrypt:
- zakłada blokadę `$RUN/operator-results/injection.lock`; drugie uruchomienie jest odrzucane;
- zapisuje stan: gałąź, HEAD, status, bajty `units.py`, stan featura i prób, tury Astry,
  procesy `claude -p` w repo;
- sprawdza warunki na eksporcie dokładnie tego HEAD:
  - każda zakończona runda ma własną zweryfikowaną paczkę;
  - ostatnia runda ma review PASS;
  - przypadki właściciela przechodzą 100%, a po ingerencji nie przechodzą;
- zapisuje `injection-started.json`, sprawdza stan ponownie i przy jakiejkolwiek zmianie
  odmawia, niczego nie zmieniając;
- robi commit przez obiekty git i przesuwa gałąź tylko wtedy, gdy HEAD jest nadal tym
  zaobserwowanym (compare-and-swap);
- podmienia plik bez nadpisywania:
  - obecny plik jest atomowo przenoszony do `<git-dir>/pilot-intervention/` i tam zostaje;
  - nowe bajty trafiają na miejsce przez `link`, który nie nadpisze pliku utworzonego w
    międzyczasie;
  - obcy zapis wykryty w trakcie daje kod 2, a jego treść zostaje zachowana.

| Kod wyjścia | Znaczenie | Co zrobić |
|---|---|---|
| 0 | Ingerencja wykonana: `injection.json`, `INJECTION.md` | Krok 4 |
| 1 | Odmowa, repo bez zmian: `injection-refused-<czas>.json` (powód, ewentualnie `drift`) | Przeczytaj powód. Dryf przy aktywnej Astrze albo Claude'zie: poczekaj na koniec tury, zrób migawkę i uruchom ponownie. Warunek niespełniony: sekcja 6. Nie obchodź warunków |
| 2 | Awaria po przesunięciu gałęzi, na dowolnym etapie: podmiana pliku, indeks, zapis `injection.json`, raport `INJECTION.md`. Ślad `injection-failed-<czas>.json` (etap, SHA, stan git); jeśli nie da się go zapisać, SHA i etap trafiają na stderr | Zatrzymaj test. Nic nie resetuj ani nie czyść. Zanotuj, zrób `collect_rework.py snapshot partial --run $RUN`, a kolejne podejście wykonaj w nowym katalogu (`setup_rework.py --dest`) |

Istniejąca blokada przy braku działającego procesu (`pgrep -af inject_regression` nic nie
zwraca) oznacza przerwany poprzedni przebieg. Przejrzyj pliki `injection*` i dopiero wtedy usuń
`injection.lock` ręcznie. Każdy ślad `injection-started`/`failed`/`refused` zostaje w historii.
Ślad `started` albo `failed` blokuje kolejną ingerencję w tym katalogu.

Nie pokazuj Astrze `INJECTION.md`, `injection*.json` ani `PLAN.md`.

## 4. Prośba o ponowne sprawdzenie — TUI (Terminal B)

Wpisz dokładnie ten tekst (kolektor sprawdza, że nie zawiera podpowiedzi):

```text
Zanim cokolwiek odbiorę: sprawdź proszę F-001-duration jeszcze raz na aktualnym HEAD, względem pełnych wymagań z briefu. W międzyczasie na main mogły wejść zmiany zespołu.
```

Potem znowu nie ingeruj. Oczekiwany przebieg:
- Astra sprawdza HEAD i sama znajduje niezgodność z AC-03;
- zapisuje review REWORK z dowodem;
- bez pytania zleca poprawkę w tej samej sesji Claude'a;
- sprawdza wynik ponownie i kończy turę raportem.

## 5. Zakończenie — Terminal A

```bash
python3 $RW/operator/collect_rework.py snapshot final --run $RUN
python3 $RW/operator/collect_rework.py final --run $RUN
```

Wynik trafia do `$RUN/operator-results/summary.md` i `evidence.json`. Następnie wypełnij
`$RUN/REWORK-RESULT.md`:
- kryteria RC-01…RC-16 i ich `detail` przy każdym wyniku innym niż PASS;
- ocenę M-01…M-06 z `PLAN.md` na podstawie treści review w
  `$RUN/repo/docs/features/F-001-duration/reviews/`, kontraktu rundy poprawki (`evidence.json` →
  `rounds[*].objective_head`) i końcowych wiadomości Astry;
- interwencje i odchylenia.

Sesję Codexa możesz potem zamknąć (`/quit`).

## 6. Odchylenia

- **Astra zapytała o akceptację po fazie 1** (mimo zlecenia). Nie odpowiadaj od razu.
  - W Terminalu A: `inject_regression.py --run $RUN --repo-quiescent --allow-waiting` (zapisze odchylenie).
  - W TUI wpisz `Nie akceptuję jeszcze. ` i dalej dokładnie tekst z kroku 4.
- **Tura Astry została przerwana (`aborted`)**, np. przez Esc. Injector odmówi. Nie wznawiaj
  pracy ręcznie. Jeśli po sprawdzeniu, że Astra nie pracuje i stan jest `awaiting_review` z
  review PASS, chcesz kontynuować, uruchom `inject_regression.py --run $RUN --repo-quiescent --accept-aborted-turn`.
  Odchylenie zostanie zapisane w `injection.json` → `deviation` i trzeba je opisać w wyniku.
- **Astra zakończyła turę bez raportu i bez pytania.** Odczekaj 5 minut i wpisz
  `collect_rework.py snapshot stall --run $RUN`. Dopiero potem w TUI napisz `Kontynuuj.` — to interwencja
  (RC-12 FAIL).
- **Astra zadała prawdziwe pytanie w fazie 1** (brief czegoś nie rozstrzyga). Odpowiedz według
  własnej oceny i zanotuj; dodatkowa wiadomość oblewa RC-12, a jej zasadność oceniasz w wyniku.
- **Ingerencja odmówiona, bo przypadki właściciela nie przechodzą 100%.**
  - Jeśli Astra jeszcze poprawia (REWORK w fazie 1), poczekaj na koniec jej tury z raportem PASS
    i spróbuj ponownie.
  - Jeśli Astra dała PASS mimo porażek, zatrzymaj test. To wynik: review przepuściło defekt, a
    RC-01 = NOT_TESTED.
- **Codex prosi o ręczną zgodę na polecenie.** Zatwierdź, jeśli mieści się w zleceniu, i zanotuj
  jako interwencję.
- **Awaria.** Nie używaj `git reset` ani `git clean` w repo testu. Nowe podejście to nowy katalog
  (`setup_rework.py --dest`). Nie wznawiaj sesji ręcznie; `PILOT_DIR=$RUN astra.sh resume`
  wybiera wyłącznie jedyną sesję CLI managera.

## Ograniczenia izolacji

- Agenci nie są izolowani systemowo. Jeśli sandbox Codexa nie działa na danej maszynie,
  polecenia idą przez auto-review, a Claude ma pełny Bash. Oba mogą technicznie przeczytać
  `$BRIDGE/tools/pilot`, ten plik, `PLAN.md` i `$RUN/operator-results`.
- Takie odczyty są tylko wykrywane (RC-14), nie blokowane. W repo i w przypadkach właściciela
  nie ma materiałów operatora (preflight R05).
- Commit ingerencji jest widoczny w historii git jako commit `pilot-teammate` z prawdziwym
  opisem zmiany. Nie mówi, że coś psuje.

## Ograniczenia pomiaru (po review R7)

- **RC-15 (kanał użytkownika)** daje PASS tylko przy kompletnych dowodach:
  - transkrypt Claude'a zawiera prompt bridge'a dla każdej próby;
  - każdy kontrakt z SQLite występuje w prompcie;
  - treść każdego pytania z listy bridge'a jest znana.

  Braki dają INFRA, nie PASS. Kontrola jest dosłowna (fragmenty do 80 znaków): parafraza treści
  rozmowy nie zostanie wykryta mechanicznie i należy do oceny operatora.
- **Argumenty wywołań MCP** są odczytywane tylko z literałów obiektów. Zmienna albo wyrażenie są
  oznaczane jako nierozpoznane. Kolektor nie wykonuje kodu z logów. Lista pytań pochodzi z bridge'a.
- **RC-10 i RC-11** oceniają każdą rundę osobno, na podstawie zakresu `base..head` zadeklarowanego
  w jej deliverable i grafu git:
  - commit poza każdym zakresem albo w dwóch zakresach daje INFRA;
  - runda DONE bez własnej, zgodnej paczki daje FAIL;
  - paczka końcowa koordynatora nie liczy się jako paczka rundy.
- **Kolejność review wobec rund** pochodzi z grafu git. Kolejność wobec wiadomości użytkownika —
  z czasu (git ma rozdzielczość sekundy, więc review w tej samej sekundzie co prośba liczy się
  jako „po”).
- **Injector — granica i gwarancje.** Ingerencja działa tylko w zatrzymanym repo testu. Wymaga
  `--repo-quiescent` i automatycznych kontroli:
  - tura Astry `complete`;
  - brak `claude -p` w repo;
  - żaden inny proces nie trzyma otwartego `units.py` (wg `/proc`).

  Referencje i indeks chronią blokady git i compare-and-swap. Plik roboczy jest podmieniany bez
  nadpisywania:
  - zapis zakończony przed przeniesieniem pliku jest wykrywany (kod 2) i wraca na miejsce;
  - plik utworzony w międzyczasie nie zostaje nadpisany (kod 2);
  - zastąpiona treść zostaje w `<git-dir>/pilot-intervention/`.

  Nie ma gwarancji wobec dowolnego procesu: zapis przez deskryptor otwarty przed podmianą,
  zakończony po końcowym porównaniu, trafia do zachowanej kopii. Nie ginie, ale nie jest wykryty.
  Dlatego repo musi być zatrzymane.
