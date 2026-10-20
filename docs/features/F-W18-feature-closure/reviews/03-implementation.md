# Review 03 — zintegrowana implementacja F-W18

## Executive summary

**REWORK**, 2026-10-20: R03-01, brak dowodu bezczynności potomka spoza task_ids.
Poprawka mieści się w autoryzacji całego featura; bez decyzji użytkownika.

## Wejścia i niezależność

Koordynator nie implementował kodu; reviewer niezależny od wykonawcy,
uczestniczył w planie/koordynacji. Zakres 7ecc851..325f669d9ce93f01ca674f7ea5bd5829e1d0b55b,
commity wykonawcy 3f9f275,6097169,325f669. Sprawdzono zakres każdego commitu,
nowe ledgery, czyste drzewo i brak zmiany plików koordynatora.
Kontrakt d20868f, review02 PASS. Bez bridge-round claim: natywny wykonawca.

## R03-01 — bezczynność potomków wymaga dowodu

Dyspozycja: blocker odbioru; wymagane kod i regresja. AC-05, kontrakt01 §2 pkt3–4.
W feature-workflow.ts close sprawdza zakończoną matching próbę tylko gdy ID jest
w f.task_ids. Potomkowie koordynatora są odwiedzani, lecz sam BLOCKED bez attempts
wystarcza do zaakceptowania close.

Reprodukcja na dostarczonym buildzie i syntetycznej tymczasowej bazie: utworzyć
root+claim, feature ready, child pod root+claim claude+block; attempts=[];
close(cancelled) zwraca cancelled. Nie uruchamiano modelu ani nie modyfikowano
danych użytkownika. Brak próby nie dowodzi rozliczenia wykonawcy i może zamknąć
drzewo, którego recovery potem jest zabronione.

Rekomendacja: sprawdzać dowód bezczynności i zgodność attempt także potomków
spoza listy rund. Jawne niewykonawcze/terminalne przypadki rozliczyć zgodnie
z kontraktem, nie uznać samego BLOCKED za dowód. Dodać regresję odtwarzającą
przypadek oraz niespójny licznik próby. Nie blokować niezwiązanej historii.
Status: przekazano do poprawki wykonawcy; jeszcze unresolved.

## Pozostałe sprawdzenia

Odczyt diffu: guards usług task/lease/attempt/artifact/deliverable, replay/slot,
migracja, MCP, projekcja diagnostyki, testy launcherów i instrukcje zamknięcia.
Ukierunkowane testy niezależne w toku; finalne wyniki i rozliczenie AC zostaną
dopisane po poprawce. Zastane baseline failures nie są przedstawiane jako PASS.

## Korekta i końcowy werdykt — 2026-10-20

**PASS zakresu F-W18**, po korekcie `0bdf45c51238c5044d6298e325a8469f215a8938`.
R03-01: **resolved**. Dokładny diff obejmuje guard wszystkich potomków, cztery
przypadki regresji i nowy ledger execution/W18-02/02.md. Poprzedni finding i dowód
pozostają powyżej. Brak nowych blockerów.

Wykonawca wykazał RED dla trzech przypadków; reviewer sprawdził finalny kod i
niezależnie uruchomił build oraz 90/90 testów: closure, feature-workflow,
timeout-recovery, identity-guard, native-launcher, projekcja diagnostyki i schema
rollback. W18_OLD_RUNTIME wskazywał rzeczywisty niezmieniony runtime0.4.3;
test launchera/migracji wykonany, nie pominięty. Testy używają atrap CLI, nie modeli.
Jawnie anulowana początkowa rezerwacja bez prób, spoza rund, nie jest już aktywną
rezerwacją; wąski wyjątek nie omija otwartej próby, HELD lease ani historii wykonania.

Kontrole niezależne: packages:check PASS, odsyłacze PASS, diff-check PASS.
Porównanie pełnych logów JS z bazą: identyczne77 nagłówków awarii, zero nowych
(76 testów i jeden suite hook). Fullsuite przy6097169:560PASS/76FAIL/7SKIP.
Po korektach325f669/0bdf45c wykonano celowane regresje, nie przedstawiamy ich jako
ponownego pełnego przebiegu. Python113/2FAIL jak baza i pilot140/140 wykonawcy
sprawdzone w zapisanych wynikach; nie powielano bez potrzeby tych niezmienionych testów.

### Pokrycie AC przy odbiorze lokalnym

| AC | Ocena i dowód |
| --- | --- |
| 01–02 | met: nowe stany i close dla ready/waiting/delivery/ended failure; testy closure |
| 03–04 | met: zachowanie historii, transakcja/fault injection, restart i replay A po B; real MCP/SQLite |
| 05 | met: rezerwacje/próby/lease, aktywny run/recovery i poprawka R03-01; zamknięcie wygrywające przed startem odmawia adaptera |
| 06 | met: guardy usług, stare pytania, refresh/create/recovery i późne zapisy; istniejący accepted replay zachowany |
| 07 | met: natywny guard przed mutacją i regresja foreign thread; kontrole workspace/instance zachowane |
| 08 | met: snapshoty rekordów task/attempt/delivery; kod close nie usuwa plików/kodu, parent effect jawny |
| 09 | met w opisanym wspieranym zakresie: real0.4.3→schema6, odmowa starego launchera i rollback; bezpośrednie stare initialize jawnie niewspierane |
| 10–11 | met jako dostawa instrukcji: odczyt skilli, standalone/staryruntime/REWORK/pauza, Mermaid i zgodność pakietów; zachowanie modeli unverified |

Granice: nie jest to PASS całej zastanej suite na tym hoście, test realnych modeli,
wydanie, wdrożenie ani odbiór użytkownika. Rekomendacja: przyjąć lokalną dostawę
F-W18 z powyższymi ograniczeniami. Dalsze wydanie/upgrade realnego projektu i jego
zamknięcie pozostają oddzielnymi operacjami. Brak potrzeby kolejnego review bez
nowych zmian lub dowodów regresji.
