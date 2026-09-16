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
