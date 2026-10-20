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
