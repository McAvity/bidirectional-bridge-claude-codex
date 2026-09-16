# Wave15 — wydanie 0.3.0, smoke oczekuje

## Zakres

Decyzja użytkownika: integracja i publikacja przed smoke, bump0.3.0, przełączenie
projektu po zamknięciu klienta, następnie smoke z planu. Dostawa b64b858 i review
10eb3ed włączone bez konfliktów z bazy 0e40d24. Runtime code pin:
`2611d1ecccfa807b1e046ebce7b05e0dded27d12` (wersja0.3.0).
Dystrybucja przypięta osobnym commitem1c75a70. Nie zmieniać istniejących runtime.

Wersja0.3.0 jest wspólna dla workspace, lockfile i pluginów. Wydanie eksperymentalne,
nie pełny odbiór behawioralny wave15; nie wywołano feature_accept. Przypisanie oryginalnego
managera i q-01 w worktree wave15 pozostały nietknięte.

## Walidacja i ograniczenia

Niezależne review03 PASS; pełna walidacja wydania i CI są rozliczane w progress.
Historyczny certification/manifest-v1.json nadal opisuje upstream0.2.0; sprawdzarka
odmawia z powodu nieujętych materiałów forka. Nie przerabiano historycznych dowodów
na pozorną certyfikację nowego wydania. Obowiązują kontrole z AGENTS oraz packages/docs.
Smoke z prawdziwymi modelami pozostaje do wykonania po aktywacji; dotychczasowe próby
nie dowodzą naturalnego routingu ani zachowania modelu po capacity.

## Aktywacja i punkt wznowienia

Nowy runtime jest zainstalowany obok ff225e5. Plan plugin update do0.3.0 nie ma
konfliktów; podczas otwartej sesji poprawnie zwraca ACTIVE_SESSION i niczego nie zapisuje.
Po normalnym zamknięciu klienta użyć przygotowanego lokalnego skryptu aktywacji,
który uruchamia wspierany plugin update, doctor, entry --status i commit deklaracji/entry.
Nie przebudowuje starego runtime, nie zmienia globalnego profilu ani nie zabija procesów.

Po resume: przeczytać HANDOFF, wykonać czysty odczyt `node ./.bridge-project/entry.mjs
--status` i odczytać wskazane nowe instrukcje. Sprawdzić runtime0.3.0 i doctor.
Następnie przygotować jednorazowy projekt smoke według planu wave15: naturalne zlecenie,
kontrolowane przerwanie managera, dokładne resume, samo „kontynuuj”, review. Jedna para,
max2 rundy Claude'a po32 tury/30min, MCP40min, max8 tur Astry, segment90min.
Nie rozszerzać budżetu i nie mylić num_turns z max_turns. Nie testować capacity przez
obciążanie usługi. Nie dodawać kolejnej pary lub powtarzać od R1 bez potrzeby.
Końcowy odbiór użytkownika pozostaje osobnym faktem.
