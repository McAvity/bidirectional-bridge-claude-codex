# Wave17 — postęp

## 2026-09-19 — brief i plan

Użytkownik zlecił feature-design i feature-plan dla osobnej dystrybucji workflowu.
Sprawdzono generator, oba marketplace, ścieżki instrukcji runtime, przekazanie
plugin-dir do Claude'a, istniejące testy dystrybucji i konwencję work-items.
Baza: `1d7f93bd766cdeb7fc8be517f4caf30c70738962`. Brak kolizji ID; Yumi CLI nie znaleziono.

Zapisano brief, design z hashem wejścia, feature.json i W17-01…04. Projekt uwzględnia
samodzielne użycie i runtime pin, kolizje legacy pluginu, wspólny generator oraz
zależność pakowania od finalnego wave16. Szczegóły hostów ma zweryfikować W17-01.

Walidacja planu: odsyłacze dokumentacji, indeks/ścieżki tasków, hash briefu i diff.
Nie uruchamiano testów produktu ani nowych prób hostów/modeli dla dokumentów.
Nie zmieniono źródeł skilli/pluginów, runtime, bazy lub profili. Bez push.

Następny krok: [feature-review planu](../features/F-W17-workflow-plugin/design.md),
potem feature-decide. Review i decyzja nie zostały jeszcze wykonane; implementacja
niezlecona. Nie przejmować ani nie zmieniać zakresu wave16.

## Checkpoint integracji planu

Plan zapisano w `96566f2` na branchu wave17-plan. Kontrole dokumentacji i indeksu PASS.
Próba fast-forward do feature-workflow została odrzucona: w głównym checkoucie
pojawiła się równoległa integracja dokumentów wave15 z konfliktem docs/HANDOFF.md.
Nie zmieniano ani nie rozwiązywano tej cudzej pracy. Plan pozostaje na wave17-plan;
po zakończeniu tamtej integracji dołączyć ten branch, zachowując oba checkpointy
HANDOFF, i skierować wave17 do review. Bez push lub implementacji.

## Integracja planu — 2026-09-19

Na jawne zlecenie użytkownika rozwiązano konflikt historycznych odbiorów wave15
z akceptacją planu wave16 (merge `630769a`), następnie dołączono branch wave17-plan.
W HANDOFF zachowano wszystkie trzy aktualne wpisy; poprzedni checkpoint oczekiwania
na integrację jest historyczny. Kod, skille, pin i runtime bez zmian.
Odsyłacze dokumentacji i diff: PASS. Następny krok: review planu wave17; bez push.

## Aktualizacja po integracji wave16 — 2026-09-19

Na zlecenie użytkownika zaktualizowano projekt, istniejące W17-01–04 i indeks.
Wejście: HEAD33d6061, techniczny odbiór907c59f, dostawa4c8cd88 i decyzja02 wave16.
Zależność od integracji wave16 spełniona; brief i AC-01…08 bez zmiany znaczenia.

Przeniesione ustalenia: kanoniczny local-delivery.md i DELIVERY=local-v1, brak
produkcyjnego receipt helpera, poprawka R02-01 (--no-renames/-z i historia ledgerów),
PARTIAL/blocker oraz klasyfikacja dirt, zachowanie starych kontraktów ZIP i pinu.
Bridge-upgrade/instalator już istnieją w obu pluginach bridge'a i pozostają tam.
Pakowanie musi odróżniać źródła po wave16 od wydanego runtime 0.3.2 sprzed wave16.

Zachowano wcześniejsze dowody: brak modelowego smoke nowej procedury nie staje się
PASS przez aktualizację planu. Nie dodano nowych zadań, API ani bramek odbioru.
Walidacja dokumentacji, indeksu/ścieżek, hasha briefu i diff; bez testów produktu,
zmian kodu/skilli, runtime, publikacji lub implementacji wave17.
Następny krok: feature-review planu wave17, potem feature-decide.

Walidacja aktualizacji: `git diff --check` bez uwag; odsyłacze dokumentacji bez nowych błędów. Pełna kontrola dokumentów pozostaje FAIL z powodu dwóch zastanych ścieżek absolutnych w wave16 (`execution/W16-01/01.md:57` i `wave16-progress.md:113`); historycznych dowodów nie zmieniano.
