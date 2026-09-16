# Review dostawy wave15 — koordynator, 2026-09-17

## Werdykt i następny krok

PASS dla zleconej implementacji bez smoke. Nie znaleziono nowych ustaleń wymagających
korekty przed testem z modelami. To rekomendacja techniczna, nie odbiór użytkownika,
zgoda na integrację ani potwierdzenie zachowania modeli.

Następny użyteczny krok to ograniczony smoke opisany w planie: naturalne zlecenie,
przerwanie managera, dokładne resume i „kontynuuj”. Nie potrzeba nowej rundy wykonawcy
lub kolejnego ogólnego review kodu. Smoke pozostaje niezlecony w tej sesji.

## Zakres i niezależność

Reviewer: koordynator nadrzędny Codex, autor planu wave15, nie wykonawca implementacji
ani manager rund dostawy. Review dotyczy 0e40d24b76b12bae35f141a449cc042772425260..
b64b858263b653e546fc021163762a2af1bc8551; ostatni kod 756ada2.
Praca w osobnym worktree/branchu wave15-coordinator-review. Worktree wykonawcy,
jego bridge, pytanie q-01 i przypięty runtime pozostawiono bez zmian.

Sprawdzono rzeczywisty diff kanonicznych instrukcji obu ról, pętli feature-execute,
entry/dispatch/locate, opcjonalnego zapisu preferencji przez plan/apply, publicznego
setupu pluginu oraz nowe i zmienione testy. Porównano dokumentację, design i końcowy
raport z planem oraz źródłami control-plane: idempotencja tworzenia/claim/state,
odczyt recovery w natywnym trybie managera i replay rund/recovery.

Poprzednie C1–C4 i I1–I8 pozostają resolved. Nie powtarzano historycznych rund ani
nie odtwarzano każdej paczki: wykorzystano wcześniejsze review i sprawdzono końcowy
stan kodu. W szczególności zachowano ograniczenie do wspieranego target runtime,
odmowy modyfikacji preferencji i rozdzielenie ról manager/executor.

## Dowody

Paczka F-W15-final-01.zip: verify PASS dla celu implementation-review,
feature docs/features/F-W15-natural-workflow i oczekiwanego base/head dostawy.
SHA-256: e17f662b42829e52c46f40ec2d5b80c3d8fc91c54cf72de2a576072e620cff54.
Manifest obejmuje 57 zmienionych plików; integralność i zgodność zakresu Git potwierdzone.

Niezależnie wykonano npm ci --ignore-scripts, build, packages:check, kontrolę
dokumentacji dostawy (165 plików przed dodaniem tego review) i git diff --check: PASS. Testy zmienionych obszarów: **107/107 PASS** w 4 plikach
(bridge-project, setup, native-launcher, wave15-continuation), 208.23 s. Pełne 565 JS / 46 Python / 140 pilot pozostaje
przytoczonym dowodem dostawy; reviewer nie przypisuje sobie jego ponowienia.

## Ograniczenia i pokrycie celu

Nie ma zmiany protokołu ani nowego mechanizmu automatycznego wzbudzania. Trwały intent
jest konwencją dla managera; testy dowodzą, że identyczny request z pliku i ten sam
klucz nie dublują operacji, a nie że model zawsze zapisze i odczyta ten plik.
Dlatego także behawioralne odczytanie AC-04/05 pozostaje do smoke, obok jawnie
niezweryfikowanych zachowań AC-01/02/07. Mechaniczne pokrycie tych kryteriów jest
wartościowe i nie jest dowodem całkowitej autonomii przy capacity.

No-handle strict stop i source-based capability check to znane, jawnie opisane
ograniczenia, nie nowe wymagane poprawki. W przyszłym smoke użyć osobno zbudowanego
runtime z wave15; release pin i runtime nadzorujący tę dostawę nie zostały przełączone.
Nie uruchamiano modeli, nie wywoływano feature_accept, nie scalano, nie publikowano
ani nie wdrażano implementacji podczas review.
