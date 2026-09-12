# Wave10 — instrukcja operatora (nie przekazywać agentom)

Status: przygotowanie; modele NIEURUCHOMIONE. Plan i budżet wymagają jawnego zatwierdzenia
użytkownika. To dwie rzeczywiste pary Astra–Claude oraz jedna krótka sesja Astry do próby
obcego managera (bez trzeciego Claude’a). Nie jest to pilot REWORK wave6.

## Zakres do zatwierdzenia

- Astra `gpt-6-astra`, effort high; Claude: profil opus/high przypiętego runnera, bez override.
- Dwie pary, po dwie rundy: łącznie najwyżej 4 uruchomienia Claude’a, każde maks. 12 tur,
  deadline 480000 ms. Zero automatycznych retry i zero dodatkowego recovery timeout.
- Najwyżej 10 tur każdej Astry oraz 2 tury dodatkowej sesji obcego managera. Wznowienie
  dokładnej Astry A nie jest nową parą. Całość maks. 40 minut od pierwszego startu.
- Wyłącznie istniejące subskrypcje; budżet dodatkowych płatnych wywołań API = 0 USD.
  Operator przed zgodą sprawdza sposób rozliczania obu klientów. Brak takiego potwierdzenia
  blokuje start. Nie oznacza to zerowego zużycia limitów subskrypcji.
- To budżety zakresu i czasu, nie twardy miernik kosztu Astry. Operator liczy tury i pilnuje
  czasu; launcher blokuje nowe uruchomienie po 40 minutach, ale nie zabija działających sesji.
- Kontrolowany timeout, legacy adoption, host mismatch i takeover są regresjami bez modeli.
  Real pilot sprawdza równoległość, waiting_user/restart, kontynuację sesji i foreign rejection.

## Przygotowanie — terminal O (operator, bez modeli)

Wybierz nowy katalog na lokalnym filesystemie, poza checkoutem. Nie używaj bazy ani katalogu
runtime aktywnego wave7. Przypięte SHA i przygotowany katalog są podane w wave10-report.md.

```bash
export W10_SOURCE=/absolute/path/to/wave10
export RUN=/tmp/wave10-pilot-new
export W10_SHA=<runtime-commit-from-wave10-report>
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" prepare --run "$RUN" --runtime-sha "$W10_SHA"
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" preflight --run "$RUN"
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

## Start i restart — trzy terminale O, A, B

Ustaw `W10_SOURCE` i `RUN` na te same wartości w każdym terminalu (powłoki nie dzielą zmiennych).

**Terminal A:**

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" launch --run "$RUN" --pair a --mode start
```

**Terminal B:**

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" launch --run "$RUN" --pair b --mode start
```

W obu TUI sprawdź `/mcp`. Wklej odpowiednio tylko `$RUN/START-A.txt` i `START-B.txt`.
Wklej je blisko siebie: oba workery muszą mieć udokumentowany wspólny przedział aktywności.
Worker B w rundzie 1 czeka maks. 180 sekund na jawną bramkę operatora; nie uruchamiaj go
z dużym wyprzedzeniem. Jeśli nie uzyskano rzeczywistego overlap, oznacz kryterium UNVERIFIED,
nie dorabiaj dowodu z samego otwarcia dwóch terminali.

Gdy Astra A zgłosi waiting_user/q1, zapisz jej dokładny `native_thread_id` z
`bridge_manager_status` w `$RUN/session-a.txt`. Analogicznie zapisz B w `session-b.txt`.
Nie używaj newest, --last, pickera ani ID guardiana. Zrób snapshot:

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" snapshot --run "$RUN" --label a-waiting-b-working
```

Zamknij TUI A normalnie, gdy żadna runda A nie pracuje, następnie **w terminalu A**:

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" launch --run "$RUN" --pair a --mode resume
```

Wznowionej Astrze A poleć: odczytaj manager_status i feature_get. Potwierdź ten sam
native_thread_id, waiting_user oraz q1. Jeśli instancja jest fenced po EOF/crash, wywołaj
`bridge_manager_resume_instance` z aktualnymi `expected_epoch` i `expected_generation`.
Nie rób takeover i nie twórz nowego featura/tasku wokół istniejącej rundy.

**Terminal O**, po potwierdzeniu resume A, gdy B nadal czeka:

```bash
mkdir -p "$RUN/b/.pilot"
touch "$RUN/b/.pilot/continue"
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" snapshot --run "$RUN" --label a-resumed
```

Poczekaj na waiting_user także B. Zapisz natywne ID obu Claude’ów z prywatnych dowodów
prób (nie wyświetlaj surowych uchwytów w publicznym raporcie). Tożsamości A/B mają być różne.

## Odrzucenie obcego managera bez mutacji

Obie pary muszą być teraz w waiting_user, bez aktywnych rund. W terminalu O:

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" snapshot --run "$RUN" --label before-foreign
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" launch --run "$RUN" --pair a --mode foreign
```

Krótka trzecia Astra ma tylko odczytać manager_status i spróbować create_task. Launcher
ustawia delegation=deny. Oczekiwany `MANAGER_FOREIGN_THREAD`; bez takeover/resume/retry.
Zapisz kod odmowy i zakończ tę TUI. Zrób snapshot `after-foreign` i porównaj oba `logical.sql`
oraz pliki stanu i owner przed/po. Muszą być identyczne w A i B; SQLite WAL/SHM nie są
porównaniem semantycznego stanu. `snapshot` używa SQLite backup API, nie kopiuje żywej bazy
przez zwykłe cp. Nie rób tej próby podczas pracujących workerów, bo ich legalne zapisy
uniemożliwią przypisanie różnic obcemu wywołaniu.

## Druga runda i zebranie dowodów

W każdej właściwej TUI przekaż syntetyczną decyzję: suffix `-A` dla A, `-B` dla B.
Poleć zapisać ją przez feature_answer_user(q1), uruchomić r2 z tym samym featurem,
max_attempts=0, max_turns=12, deadline_ms=480000, bieżącym HEAD jako base i paczką r2.zip
obok r1.zip. Claude ma kontynuować swoją natywną sesję, dodać suffix, testy, ledger,
commit i zweryfikowaną paczkę. Astra sprawdza dostawę, raportuje wynik i kończy; bez
feature_accept, dodatkowych rund i kolejnego pełnego review.

```bash
python3 "$W10_SOURCE/tools/pilot/wave10/operator.py" snapshot --run "$RUN" --label final
```

Operator uruchamia w każdym worktree `python3 -m unittest discover -v` oraz exporter
`verify --repo "$RUN/a" --archive <dokładna-paczka> --expect-feature F-W10-pair
--expect-purpose implementation-review --expect-base <baza-rundy> --expect-head <head-rundy>`
(analogicznie B, cztery paczki). Zachowuje logi, hashe, zakresy commitów i porównanie sesji
w prywatnym katalogu evidence. Snapshot przechowuje SQLite, logiczny dump, markery,
dowody zakończeń, HEAD/status oraz hashe ZIP. Operator dopisuje chronologię działań,
wyniki testów/verify, wersje klientów i dostępne telemetryczne koszty/tury/czas.
Brakujące koszty Astry oznacza `unknown`, nie zero. Surowe rollouty są opcjonalne i prywatne.

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
