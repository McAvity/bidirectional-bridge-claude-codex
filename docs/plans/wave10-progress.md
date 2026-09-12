# Wave10 — postęp

Status: W TOKU — integracja lokalna, pilot modeli nieuruchomiony.

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
| W10-02 | Wave7 bazuje na kodzie sprzed timeout recovery; zastąpienie plików cofnęłoby opublikowane recovery. | Zamknięty: trzystronne połączenie; konflikty control-plane (lazy services + evidence) i tools (guard + budget) rozwiązane. Regresja FAILED/TIMEOUT przez dispatcher z restartem, takeover, foreign replay i no-mutation przechodzi. Pełne testy: 425 JS / 29 exchange / 114 pilot tooling PASS. |
| W10-04 | Opublikowany test stdio timeout nie przekazywał nowego kontekstu native; create odrzucony przed mutacją. | Zamknięty: harness ma native metadata i jawne resume_instance po EOF; 8/8 stdio i pełne 425/425 JS PASS. |
| W10-05 | Nazwa operator.py przesłaniała moduł standardowy Python przy bezpośrednim starcie CLI. | Poprawiono na pilot.py; dodany test subprocess --help. Pierwsze prepare zatrzymane przed utworzeniem katalogu. |
| W10-03 | Pilot wymaga dokładnie wspieranego hosta Codex 0.154.0 i prawdziwego kontekstu wywołań. | Otwarty: preflight i jawne stop conditions; fake nie potwierdza modeli. |

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
