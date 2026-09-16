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
