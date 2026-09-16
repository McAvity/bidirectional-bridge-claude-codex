# Wave15 — postęp

## 2026-09-16 — DRAFT

Zapisano [wave15.md](wave15.md) na prośbę użytkownika. Kierunek: naturalne zlecanie
featurów bez wymieniania skilli i powtarzania instrukcji koordynacji.
Wznowienie, status/powiadomienia i zgodność klientów są kandydatami do oceny zakresu.

Implementacja niezlecona. Najpierw odbiór i integracja wave13 oraz wave14, potem
uzupełnienie draftu o rzeczywiste luki, zakres, kryteria i walidację.
Brak zmian w ich worktree, runtime, konfiguracji i zleceniach. Bez modeli i push.

## Uzupełnienie — bezpieczne wznowienie

Na prośbę użytkownika dodano przypadek capacity/przerwania: samo „kontynuuj”,
checkpoint przed delegacją, uzgodnienie stanu/idempotencji bez dublowania prób.
Bez nowego skilla do pamiętania; automatyczne retry niedostępnego modelu nie jest
obiecane. Wave15 nadal DRAFT po integracji wave13/14; brak implementacji i zmian
w pracujących falach.

## Doprecyzowanie po integracji wave13/14

Baza e721aa4; wybrany runtime ff225e5, rzeczywisty doctor: ok. Plan ograniczono do
naturalnego zlecania i bezpiecznego wznowienia. Dodano zweryfikowane luki, proponowane
miejsce preferencji, W15-01…04, AC-01…09 i oddzielny, niezlecony smoke.

Autoryzacja użytkownika: publikacja bieżących zmian/CI oraz dopracowanie planu,
wyraźnie bez implementacji. Nie zmieniono skilli, kodu, konfiguracji ani runtime;
nie uruchamiano modeli. Następny krok: osobne zlecenie wykonania planu.

## Publikacja i walidacja

Plan: abdbbde. Publikacja feature-workflow: 38367c8.
[CI35130755901](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/35130755901): SUCCESS,
łącznie z build, pakietami, dokumentacją i testami JS/Python/pilot.
Pierwszy przebieg wykrył nieaktualne oczekiwanie konfiguracji repo w teście launchera;
38367c8 dostosował wyłącznie test do migracji dispatchera (lokalnie 16/16).
Nie jest to implementacja wave15. Runtime ff225e5 pozostał bez zmian.
Kontrola dokumentów i git diff --check: PASS. Następny krok: osobne zlecenie wykonania.

## Wykonanie zlecone — 2026-09-16

Baza 0e40d24b76b12bae35f141a449cc042772425260, czysty branch/worktree wave15.
Zlecono cały plan z lokalnymi commitami, testami i poprawkami; historyczny status
„niezlecona” nie obowiązuje implementacji. Smoke nadal poza zakresem.
Feature F-W15-natural-workflow; root task_7zykhr76zt, run_shm6vat1q4.
Runtime nadzorujący przypięty oddzielnie do ff225e550966, pozostaje niezmieniony.
Następny krok: W15-01 przez Claude, jedna sesja dla kolejnych rund.

## Runda 1 i review kontraktów

W15-01: 2345b30, task_10ehn2rfm9 DONE. Paczka r01 zweryfikowana przez koordynatora.
Review 01-contracts: REWORK C1-C4 (pristine wejście, odtwarzalny checkpoint,
zakaz zastępczego featura, ścisłe replay i poprawne scenariusze). Korekty w ramach
istniejącej zgody, bez nowego protokołu. Następna runda: korekty projektu i W15-02.
Walidacja bazowa: npm ci --ignore-scripts PASS, npm run build PASS, 140 pilot tests PASS.
Node24.15.0 / Python3.12.3. Smoke niezlecony; aktywny runtime bez zmian.

## Runda 2 i review — ea7d1bd

W15-02: c4483b4, 55d3e5f oraz dokumenty/testy do ea7d1bd; task_axt2g9bfzf DONE.
Paczka r02 zweryfikowana, 30 plików zgodnych ze scope, czysty worktree.
Review: C1/C3 resolved; C2/C4 progress, pozostają konkretne korekty.
Nowe I1-I5: legacy entry, diff nowego AGENTS, pin commit w plugin status,
markery nie są zgodą, cienkie wejście pluginu. Niezależne próby potwierdziły błędy.
Wykonawca: build, 6 entry/plugin + 3 preference, packages i links PASS.
Następny krok: te poprawki wraz z W15-03; trzecie sprawdzenie C2/C4 wymaga step-back.
Nie zmieniono aktywnego runtime, projektu .bridge-project ani globalnej konfiguracji.

## Runda 3 i step-back — 02ced39

W15-03 + korekty: 59b808e, 02ced39; task_ztxwvbm7ez DONE, paczka r03 PASS.
I1-I5 oraz C4 resolved. C2: step-back przy trzecim review — zachowano proste
intent JSON + istniejące replay, bez helpera/nowego API. Lokalizacja już poprawna;
pozostał dowód rzeczywistego odczytu requestu z pliku po przerwie. I6: test no-handle
musi wykluczyć żywy lease i nie udawać śmierci procesu. Następny krok: wąska korekta
testów i W15-04 raport w tej samej sesji, potem końcowe review.
Wykonawca: build, 9 continuation + 12 entry + 2 legacy, packages/links PASS.
Koordynator uruchomił pełne npm test (wynik oczekiwany); wcześniejsze Python46/pilot140
pozostają ważne dla niezmienionych obszarów. Bez smoke/push/merge/deployment.

Pełne JS zakończone: 560 PASS, 1 FAIL (native-launcher: stare oczekiwanie identycznych
skilli obu ról). Finding I7: dostosować test do jawnego podziału manager/executor,
zachowując kontrolę wspólnych zasobów. Włączone do następnej rundy korekt/W15-04.

## Runda 4 — 55cb52a; końcowa kontrola kompatybilności

Kod/testy 0b563ba, raport55cb52a, task_16hy41wpzb DONE; paczka r04 PASS.
Wszystkie C1-C4, I1-I7 closed. Pełne JS563 PASS, build/packages/links/diff PASS;
niezależne continuation/role12 oraz orphan/no-handle i odmowy preferencji PASS.
Nowe I8 z rzeczywistej próby: plugin --with-preference z przypiętym ff225e5 zapisuje
blok wskazujący STARE entry bez --status. Wąska odmowa tej kombinacji potrzebna przed
dostawą. Step-back klasy problemu wejścia: sprawdzać target runtime i odmówić, bez
fallbacków/nowego instalatora/zmiany pinu. Następna runda tylko I8 i raport/validation.

## Dostawa końcowa — 2026-09-16

Runda5 task_8prrdyndtz DONE; kod756ada2, raport292cb14, paczka r05 verified PASS.
I8 resolved niezależną próbą na rzeczywistym ff225e5: odmowa bez zapisów.
Cały zakres W15-01–04 technical PASS, C1-C4/I1-I8 closed. Pełne JS565/37 files
(wykonawca); focused12/Python46/pilot140 (koordynator, retained), build/packages/links/diff PASS.
Pięć rund Claude bez recovery; testy bez modeli, smoke nadal niewykonany.
Finalny [handoff](../features/F-W15-natural-workflow/handoff.md) zawiera commity,
ograniczenia i punkt wznowienia. Eksport F-W15-final-01.zip, potem q-01 odbiór użytkownika.
Nie uruchamiać kolejnej rundy; root pozostaje otwarty do rzeczywistej decyzji.
Brak push/merge/deploy; aktywny runtime/piny/konfiguracja nietknięte.
