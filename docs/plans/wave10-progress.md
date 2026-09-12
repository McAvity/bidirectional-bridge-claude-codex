# Wave10 — postęp

Status: integracja po review koordynatora; korekta harmonogramu pilota w toku. Cały wave10 nadal otwarty; modele nieuruchomione.

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
| W10-03 | Pilot wymaga dokładnie wspieranego hosta Codex 0.154.0 i prawdziwego kontekstu wywołań. | Przygotowanie zamknięte: host 0.154.0, preflight i dwa handshake PASS. Realne metadata/model path nadal NOT RUN; start wymaga zgody na konkretny budżet. |
| W10-04 | Opublikowany test stdio timeout nie przekazywał nowego kontekstu native; create odrzucony przed mutacją. | Zamknięty: harness ma native metadata i jawne resume_instance po EOF; 8/8 stdio i pełne 425/425 JS PASS. |
| W10-05 | Nazwa operator.py przesłaniała moduł standardowy Python przy bezpośrednim starcie CLI. | Zamknięty: pilot.py i test subprocess --help PASS. Pierwsze prepare zatrzymane przed utworzeniem katalogu. |
| W10-06 | Kontrola instrukcji ujawniła max_attempts spoza schematu feature_run oraz skrócone expect-feature eksportera. | Zamknięty: wbudowane zero retry i pełna ścieżka docs/features/F-W10-pair; finalne prepare oraz export/verify obu fixture PASS. |
| W10-07 | Test przenośności odrzuca także wzmiankę wave6 w tools/pilot. | Zamknięty: neutralna wzmianka o wcześniejszym pilocie REWORK; 115/115 testów PASS. |

| W10-08 | Bramka B/r1 180 s nie obejmowała rundy A 480 s oraz review/restartu. | Harmonogram v2: bramka wyłącznie B/r2, po r1/review obu par; 540 s bramki, 480 s operatora, B/r2 1200 s, MCP 1320 s, całość 60 min. 9 testów narzędzia + portability PASS; nowy pin/prepare w toku. |

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

## Końcowy handoff

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
