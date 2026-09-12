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
| W10-01 | Historia wave7 zawiera prywatne ścieżki operatora i namespace rzeczywistego worktree. | Zamknięty: import oczyszczonego snapshotu bez przodków wave7; mapowanie wszystkich 32 commitów. Metadane author/committer mają publiczny noreply, brak wykrytych linków sesji/sekretów. |
| W10-02 | Wave7 bazuje na kodzie sprzed timeout recovery; zastąpienie plików cofnęłoby opublikowane recovery. | Zamknięty: trzystronne połączenie; konflikty control-plane (lazy services + evidence) i tools (guard + budget) rozwiązane. Regresja FAILED/TIMEOUT przez dispatcher z restartem, takeover, foreign replay i no-mutation przechodzi. Pełne testy w toku. |
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
